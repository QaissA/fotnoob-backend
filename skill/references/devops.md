# DevOps Reference — AWS CDK, EKS, CI/CD

Infrastructure as code, Kubernetes configuration, deployment pipelines, and monitoring for the FotMob-clone platform.

---

## Table of Contents
1. [AWS CDK Stack Overview](#1-aws-cdk-stack-overview)
2. [EKS Cluster Setup](#2-eks-cluster-setup)
3. [Kubernetes Manifests](#3-kubernetes-manifests)
4. [CI/CD Pipeline — GitHub Actions](#4-cicd-pipeline--github-actions)
5. [Dockerfile — Node.js Service](#5-dockerfile--nodejs-service)
6. [Environment & Secrets Management](#6-environment--secrets-management)
7. [Monitoring & Alerting](#7-monitoring--alerting)
8. [Auto-Scaling Rules](#8-auto-scaling-rules)
9. [CloudFront CDN Setup](#9-cloudfront-cdn-setup)

---

## 1. AWS CDK Stack Overview

```typescript
// infrastructure/lib/fotmob-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export class FotmobStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── VPC ────────────────────────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, 'FotmobVpc', {
      maxAzs: 3,
      natGateways: 2,   // 2 for HA; use 1 for dev to save cost
      subnetConfiguration: [
        { name: 'public',   subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private',  subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 28 },
      ],
    });

    // ── AURORA POSTGRESQL ──────────────────────────────────────────────────
    const dbCluster = new rds.DatabaseCluster(this, 'FotmobDB', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_4,
      }),
      writer: rds.ClusterInstance.provisioned('writer', {
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.XLARGE2),
      }),
      readers: [
        rds.ClusterInstance.provisioned('reader1', {
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.XLARGE),
        }),
      ],
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      defaultDatabaseName: 'fotmob',
      storageEncrypted: true,
      backup: { retention: cdk.Duration.days(7) },
    });

    // ── ELASTICACHE REDIS ──────────────────────────────────────────────────
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnets', {
      description: 'Redis subnet group',
      subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
    });

    const redis = new elasticache.CfnReplicationGroup(this, 'FotmobRedis', {
      replicationGroupDescription: 'FotMob Redis cluster',
      cacheNodeType: 'cache.r6g.large',
      engine: 'redis',
      numCacheClusters: 2,   // 1 primary + 1 replica
      automaticFailoverEnabled: true,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
    });

    // ── S3 BUCKETS ─────────────────────────────────────────────────────────
    const mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      bucketName: 'fotmob-media',
      cors: [{ allowedMethods: [s3.HttpMethods.GET], allowedOrigins: ['*'] }],
      lifecycleRules: [
        { expiration: cdk.Duration.days(365), prefix: 'highlights/' },  // auto-expire old videos
      ],
    });

    const statsBucket = new s3.Bucket(this, 'StatsBucket', {
      bucketName: 'fotmob-stats',
      versioned: true,
    });

    // ── SQS QUEUES ─────────────────────────────────────────────────────────
    const notifDLQ = new sqs.Queue(this, 'NotifDLQ', {
      retentionPeriod: cdk.Duration.days(14),
    });

    const notifQueue = new sqs.Queue(this, 'NotifQueue', {
      visibilityTimeout: cdk.Duration.seconds(30),
      deadLetterQueue: { queue: notifDLQ, maxReceiveCount: 3 },
    });

    const summaryQueue = new sqs.Queue(this, 'SummaryQueue', {
      visibilityTimeout: cdk.Duration.minutes(2),  // AI generation can take ~30s
    });

    // ── EKS CLUSTER ────────────────────────────────────────────────────────
    const cluster = new eks.Cluster(this, 'FotmobEKS', {
      version: eks.KubernetesVersion.V1_29,
      vpc,
      defaultCapacity: 0,   // manage node groups explicitly
    });

    cluster.addNodegroupCapacity('AppNodes', {
      instanceTypes: [new ec2.InstanceType('t3.medium')],
      minSize: 2,
      maxSize: 20,
      desiredSize: 3,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    cluster.addNodegroupCapacity('WSNodes', {
      instanceTypes: [new ec2.InstanceType('t3.large')],   // WS hub needs more RAM
      minSize: 1,
      maxSize: 10,
      desiredSize: 2,
      labels: { workload: 'websocket' },
    });

    // Outputs
    new cdk.CfnOutput(this, 'DBWriterEndpoint', { value: dbCluster.clusterEndpoint.hostname });
    new cdk.CfnOutput(this, 'RedisEndpoint', { value: redis.attrPrimaryEndPointAddress });
    new cdk.CfnOutput(this, 'EKSClusterName', { value: cluster.clusterName });
    new cdk.CfnOutput(this, 'NotifQueueUrl', { value: notifQueue.queueUrl });
  }
}
```

---

## 2. EKS Cluster Setup

```bash
# Bootstrap CDK (first time only)
cdk bootstrap aws://ACCOUNT_ID/eu-west-1

# Deploy
cdk deploy FotmobStack

# Configure kubectl
aws eks update-kubeconfig --region eu-west-1 --name FotmobEKS

# Verify nodes
kubectl get nodes

# Install cluster add-ons
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# Install AWS Load Balancer Controller
helm repo add eks https://aws.github.io/eks-charts
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=FotmobEKS \
  --set serviceAccount.create=true
```

---

## 3. Kubernetes Manifests

### Scores Service Deployment

```yaml
# k8s/scores-service.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: scores-service
  namespace: fotmob
spec:
  replicas: 3
  selector:
    matchLabels:
      app: scores-service
  template:
    metadata:
      labels:
        app: scores-service
    spec:
      containers:
        - name: scores-service
          image: ACCOUNT.dkr.ecr.eu-west-1.amazonaws.com/fotmob/scores:latest
          ports:
            - containerPort: 3001
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: fotmob-secrets
                  key: database-url
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: fotmob-secrets
                  key: redis-url
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /health
              port: 3001
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: 3001
            initialDelaySeconds: 15
            periodSeconds: 20
---
apiVersion: v1
kind: Service
metadata:
  name: scores-service
  namespace: fotmob
spec:
  selector:
    app: scores-service
  ports:
    - port: 3001
      targetPort: 3001
---
# Horizontal Pod Autoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: scores-service-hpa
  namespace: fotmob
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: scores-service
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
```

### WebSocket Hub (sticky sessions required)

```yaml
# k8s/ws-hub.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ws-hub
  namespace: fotmob
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ws-hub
  template:
    metadata:
      labels:
        app: ws-hub
    spec:
      nodeSelector:
        workload: websocket     # pin to WS node group
      containers:
        - name: ws-hub
          image: ACCOUNT.dkr.ecr.eu-west-1.amazonaws.com/fotmob/ws-hub:latest
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 200m
              memory: 512Mi
            limits:
              cpu: 1000m
              memory: 1Gi
---
apiVersion: v1
kind: Service
metadata:
  name: ws-hub
  namespace: fotmob
  annotations:
    # AWS NLB for WebSocket support (ALB has 60s idle timeout — too short)
    service.beta.kubernetes.io/aws-load-balancer-type: nlb
    service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled: "true"
spec:
  type: LoadBalancer
  selector:
    app: ws-hub
  ports:
    - port: 443
      targetPort: 8080
      protocol: TCP
```

### Namespace + Ingress

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: fotmob

---
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: fotmob-ingress
  namespace: fotmob
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:...
    alb.ingress.kubernetes.io/ssl-redirect: "443"
spec:
  rules:
    - host: api.fotmob.app
      http:
        paths:
          - path: /matches
            pathType: Prefix
            backend:
              service: { name: scores-service, port: { number: 3001 } }
          - path: /leagues
            pathType: Prefix
            backend:
              service: { name: scores-service, port: { number: 3001 } }
          - path: /players
            pathType: Prefix
            backend:
              service: { name: stats-service, port: { number: 3002 } }
          - path: /teams
            pathType: Prefix
            backend:
              service: { name: stats-service, port: { number: 3002 } }
          - path: /users
            pathType: Prefix
            backend:
              service: { name: user-service, port: { number: 3003 } }
          - path: /news
            pathType: Prefix
            backend:
              service: { name: news-service, port: { number: 3004 } }
          - path: /search
            pathType: Prefix
            backend:
              service: { name: search-service, port: { number: 3005 } }
```

---

## 4. CI/CD Pipeline — GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

env:
  AWS_REGION: eu-west-1
  ECR_REGISTRY: ${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.eu-west-1.amazonaws.com

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [scores, stats, user, news, search, ws-hub, notifications]

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to ECR
        uses: aws-actions/amazon-ecr-login@v2

      - name: Set up pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests
        run: pnpm --filter @fotmob/${{ matrix.service }} test

      - name: Build & push Docker image
        working-directory: services/${{ matrix.service }}
        run: |
          IMAGE=$ECR_REGISTRY/fotmob/${{ matrix.service }}
          TAG=${GITHUB_SHA::8}

          docker build -t $IMAGE:$TAG -t $IMAGE:latest .
          docker push $IMAGE:$TAG
          docker push $IMAGE:latest
          echo "IMAGE_TAG=$TAG" >> $GITHUB_ENV

      - name: Deploy to EKS
        run: |
          aws eks update-kubeconfig --region $AWS_REGION --name FotmobEKS
          kubectl set image deployment/${{ matrix.service }}-service \
            ${{ matrix.service }}-service=$ECR_REGISTRY/fotmob/${{ matrix.service }}:${{ env.IMAGE_TAG }} \
            -n fotmob
          kubectl rollout status deployment/${{ matrix.service }}-service -n fotmob

  # Deploy Angular web app to S3 + CloudFront invalidation
  deploy-web:
    runs-on: ubuntu-latest
    needs: build-and-deploy

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
        working-directory: apps/web

      - run: npm run build:prod
        working-directory: apps/web
        env:
          API_URL: https://api.fotmob.app
          WS_URL: wss://ws.fotmob.app

      - name: Deploy to S3
        run: |
          aws s3 sync apps/web/dist/browser s3://fotmob-web --delete

      - name: Invalidate CloudFront
        run: |
          aws cloudfront create-invalidation \
            --distribution-id ${{ secrets.CF_DISTRIBUTION_ID }} \
            --paths "/*"
```

---

## 5. Dockerfile — Node.js Service

Multi-stage build — dev dependencies excluded from final image.

```dockerfile
# services/scores/Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ packages/
COPY services/scores/ services/scores/

RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# Build the service
RUN pnpm --filter @fotmob/scores build
RUN pnpm --filter @fotmob/scores --prod deploy /app/deploy

# ── Final image ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup -S fotmob && adduser -S fotmob -G fotmob

COPY --from=builder /app/deploy .

# Run Prisma migrations on startup (or use init container in Kubernetes)
# ENTRYPOINT handles migrations then starts the server
COPY services/scores/entrypoint.sh .
RUN chmod +x entrypoint.sh

USER fotmob
EXPOSE 3001

ENTRYPOINT ["./entrypoint.sh"]
```

```bash
#!/bin/sh
# entrypoint.sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting server..."
exec node dist/index.js
```

---

## 6. Environment & Secrets Management

Use **AWS Secrets Manager** for all sensitive config. Never bake secrets into images or ConfigMaps.

```typescript
// infrastructure/lib/secrets.ts — create secrets in CDK
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

const dbSecret = new secretsmanager.Secret(this, 'DBSecret', {
  secretName: 'fotmob/database-url',
  generateSecretString: { excludeCharacters: '"@/' },
});

const jwtSecret = new secretsmanager.Secret(this, 'JWTSecret', {
  secretName: 'fotmob/jwt-secret',
  generateSecretString: { passwordLength: 64 },
});
```

```yaml
# In Kubernetes — use External Secrets Operator to sync from Secrets Manager
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: fotmob-secrets
  namespace: fotmob
spec:
  refreshInterval: 5m
  secretStoreRef:
    name: aws-secretsmanager
    kind: ClusterSecretStore
  target:
    name: fotmob-secrets
  data:
    - secretKey: database-url
      remoteRef:
        key: fotmob/database-url
    - secretKey: redis-url
      remoteRef:
        key: fotmob/redis-url
    - secretKey: jwt-secret
      remoteRef:
        key: fotmob/jwt-secret
```

---

## 7. Monitoring & Alerting

Use **CloudWatch + Grafana** for dashboards; **PagerDuty** for on-call alerts.

```typescript
// CDK — CloudWatch alarms
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';

const alertTopic = new sns.Topic(this, 'AlertTopic');

// Alert: API error rate > 1%
new cloudwatch.Alarm(this, 'HighErrorRate', {
  metric: new cloudwatch.Metric({
    namespace: 'fotmob/api',
    metricName: 'ErrorRate',
    statistic: 'Average',
    period: cdk.Duration.minutes(1),
  }),
  threshold: 0.01,
  evaluationPeriods: 3,
  alarmDescription: 'API error rate exceeded 1%',
}).addAlarmAction(new actions.SnsAction(alertTopic));

// Alert: Aurora replica lag > 500ms
new cloudwatch.Alarm(this, 'ReplicaLag', {
  metric: dbCluster.metric('AuroraReplicaLag', {
    statistic: 'Maximum',
    period: cdk.Duration.minutes(1),
  }),
  threshold: 500,
  evaluationPeriods: 2,
});
```

### Key metrics to track
| Metric | Warning | Critical |
|--------|---------|----------|
| API p99 latency | > 500ms | > 2s |
| API error rate | > 0.5% | > 2% |
| WS connections/pod | > 8,000 | > 12,000 |
| Redis memory usage | > 70% | > 90% |
| Aurora CPU | > 60% | > 80% |
| Aurora replica lag | > 200ms | > 1s |
| Notif. queue depth | > 5,000 | > 50,000 |
| Pod OOMKilled events | > 0 | — |

---

## 8. Auto-Scaling Rules

```yaml
# Cluster Autoscaler — scales EC2 node groups
# Install via Helm
helm install cluster-autoscaler autoscaler/cluster-autoscaler \
  --set autoDiscovery.clusterName=FotmobEKS \
  --set awsRegion=eu-west-1 \
  --set rbac.serviceAccount.annotations."eks\.amazonaws\.com/role-arn"=arn:aws:iam::...

# KEDA — scale notification workers on SQS queue depth
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: notif-worker-scaler
  namespace: fotmob
spec:
  scaleTargetRef:
    name: notifications-service
  minReplicaCount: 1
  maxReplicaCount: 50
  triggers:
    - type: aws-sqs-queue
      metadata:
        queueURL: https://sqs.eu-west-1.amazonaws.com/.../fotmob-notif-queue
        queueLength: "1000"   # scale up when > 1000 messages per worker
        awsRegion: eu-west-1
```

---

## 9. CloudFront CDN Setup

```typescript
// CDK — CloudFront distribution for Angular web app
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

const webBucket = new s3.Bucket(this, 'WebBucket', {
  websiteIndexDocument: 'index.html',
  websiteErrorDocument: 'index.html',   // SPA — all 404s serve index.html
  publicReadAccess: false,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
});

const distribution = new cloudfront.Distribution(this, 'WebCDN', {
  defaultBehavior: {
    origin: new origins.S3Origin(webBucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    compress: true,
  },
  // Cache API responses at edge for non-live data
  additionalBehaviors: {
    '/api/leagues/*': {
      origin: new origins.HttpOrigin('api.fotmob.app'),
      cachePolicy: new cloudfront.CachePolicy(this, 'ApiCache', {
        defaultTtl: cdk.Duration.seconds(60),
        maxTtl: cdk.Duration.seconds(300),
        minTtl: cdk.Duration.seconds(0),
      }),
    },
  },
  priceClass: cloudfront.PriceClass.PRICE_CLASS_100,  // EU + NA only (cheapest)
  domainNames: ['fotmob.app'],
  certificate: acmCert,
  errorResponses: [
    { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
    { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
  ],
});
```

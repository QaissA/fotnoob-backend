import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/configuration.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  const config = app.get(ConfigService<AppConfig>);
  const port = config.get('PORT', { infer: true })!;
  const allowedOrigins = config
    .get('ALLOWED_ORIGINS', { infer: true })!
    .split(',')
    .map((o) => o.trim());

  // CORS
  await app.register(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@fastify/cors') as Parameters<typeof app.register>[0],
    { origin: allowedOrigins, credentials: true },
  );

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Swagger / OpenAPI
  const swaggerConfig = new DocumentBuilder()
    .setTitle('FotNob API')
    .setDescription('Live football scores, stats, news & notifications')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(port, '0.0.0.0');
  console.log(`FotNob API running on http://0.0.0.0:${port}/api/v1`);
  console.log(`Swagger docs at  http://0.0.0.0:${port}/api/docs`);
}

bootstrap();

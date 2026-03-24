import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { RedisService } from '../redis/redis.service.js';

interface SubscribePayload {
  matchId: string;
}

@WebSocketGateway({
  namespace: '/live',
  cors: { origin: '*' },
})
export class ScoresGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ScoresGateway.name);

  constructor(private readonly redis: RedisService) {}

  afterInit(): void {
    // Subscribe to Redis match-events channel; fan-out to WS rooms
    void this.redis.subscriber.subscribe('match-events', 'match-finished');

    this.redis.subscriber.on('message', (channel: string, data: string) => {
      if (channel === 'match-events') {
        const event = JSON.parse(data) as { matchId: string };
        this.server.to(`match:${event.matchId}`).emit('matchEvent', event);
      }
      if (channel === 'match-finished') {
        const payload = JSON.parse(data) as { matchId: string };
        this.server.to(`match:${payload.matchId}`).emit('matchFinished', payload);
      }
    });

    this.logger.log('ScoresGateway initialised — subscribed to Redis channels');
  }

  handleConnection(client: Socket): void {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @MessageBody() payload: SubscribePayload,
    @ConnectedSocket() client: Socket,
  ): void {
    void client.join(`match:${payload.matchId}`);
    this.logger.debug(`${client.id} subscribed to match:${payload.matchId}`);
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @MessageBody() payload: SubscribePayload,
    @ConnectedSocket() client: Socket,
  ): void {
    void client.leave(`match:${payload.matchId}`);
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket): void {
    client.emit('pong');
  }
}

import { Module } from '@nestjs/common';
import { AppController, ChatGateway } from './app.controller';

@Module({ controllers: [AppController], providers: [ChatGateway] })
export class AppModule {}

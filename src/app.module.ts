import { Module } from '@nestjs/common';
import { AppController, ChatGateway } from './app.controller';
import { GroupChatController, GroupChatGateway } from './group-chat';

@Module({ controllers: [AppController, GroupChatController], providers: [ChatGateway, GroupChatGateway] })
export class AppModule {}

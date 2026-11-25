import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useStaticAssets(join(__dirname, '..', 'public'));
  await app.listen(process.env.PORT || 3000);
  console.log(`Anon is running at http://localhost:${process.env.PORT || 3000}`);
}
bootstrap();

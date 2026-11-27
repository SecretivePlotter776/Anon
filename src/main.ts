import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { readFileSync } from 'fs';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  // Inject the optional call-alert enhancement before the app's inline client initializes Socket.IO.
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.path === '/') {
      try {
        const index = readFileSync(join(__dirname, '..', 'public', 'index.html'), 'utf8');
        const html = index.replace(
          '<script src="https://cdn.socket.io/4.8.1/socket.io.min.js"></script>',
          '<script src="https://cdn.socket.io/4.8.1/socket.io.min.js"></script>\n<script src="/call-notifications.js"></script>',
        );
        res.type('html').send(html);
        return;
      } catch { /* Let static serving handle the request if the source file is unavailable. */ }
    }
    next();
  });
  app.useStaticAssets(join(__dirname, '..', 'public'));
  await app.listen(process.env.PORT || 3000);
  console.log(`Anon is running at http://localhost:${process.env.PORT || 3000}`);
}
bootstrap();

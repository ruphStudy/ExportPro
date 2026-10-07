import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import { join } from 'path';
import { AppConfig } from './config/configuration';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  // rawBody: outreach provider webhooks verify signatures over the exact bytes.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService<AppConfig>);

  app.use(cookieParser());
  // Local-disk upload adapter (see modules/storage/storage.service.ts) — served directly.
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  const globalPrefix = config.get('app.globalPrefix', { infer: true })!;
  app.setGlobalPrefix(globalPrefix);

  app.enableCors({
    origin: config.get('app.corsOrigin', { infer: true }),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  const swaggerDoc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ExportPro API')
      .setDescription(
        'Import/export intelligence and automation platform — API foundation',
      )
      .setVersion('1')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, swaggerDoc);

  const port = config.get('app.port', { infer: true })!;
  await app.listen(port);
  Logger.log(
    `ExportPro API listening on port ${port} (prefix: /${globalPrefix})`,
    'Bootstrap',
  );
}

bootstrap();

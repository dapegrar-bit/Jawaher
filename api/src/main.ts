import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './server';
import { json } from 'express';
async function main() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({limit: "1mb"})); // bounded for externally signed UBL test XML in Base64
  app.enableCors({origin: process.env.WEB_ORIGIN || 'http://localhost:3000', credentials: true,
    methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','X-Jawaher-Client']});
  app.use((req: any, res: any, next: any) => {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method) && req.header('X-Jawaher-Client') !== 'web') {
      return res.status(403).json({message:'Missing required application request header'});
    }
    const origin = req.header('Origin');
    if (origin && origin !== (process.env.WEB_ORIGIN || 'http://localhost:3000')) {
      return res.status(403).json({message:'Forbidden origin'});
    }
    next();
  });
  await app.listen(Number(process.env.PORT || 4000), '0.0.0.0');
}
main().catch(err=>{console.error(err);process.exit(1);});

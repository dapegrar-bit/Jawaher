import { Injectable, ServiceUnavailableException, HttpException } from '@nestjs/common';
import { createClient } from 'redis';
import type { Request } from 'express';
import { createHash } from 'node:crypto';

@Injectable()
export class AuthRateLimiter {
  private redis?: ReturnType<typeof createClient>;
  private connecting?: Promise<void>;
  private local = new Map<string,{count:number,expiry:number}>();
  private async connect(): Promise<ReturnType<typeof createClient>> {
    const client = this.redis ?? createClient({url:process.env.REDIS_URL!, socket:{connectTimeout:3500,reconnectStrategy: false}});
    if (!this.redis) { client.on('error', () => {}); this.redis=client; }
    if (!client.isOpen) {
      this.connecting ||= client.connect().then(()=>{}).finally(()=>{this.connecting=undefined;});
      await this.connecting;
    }
    return client;
  }
  // Fixed window protects auth endpoints across multiple API instances.
  async check(req:Request, purpose:'login'|'register',principal:string):Promise<void> {
    const addr = req.ip || req.socket.remoteAddress || 'unknown';
    const identity=createHash('sha256').update(principal.trim().toLowerCase().slice(0,254)).digest('hex').slice(0,24);
    const key = `jawaher:auth:${purpose}:${addr}:${identity}`;
    const max = purpose==='login' ? 8 : 4;
    if (process.env.REDIS_URL) {
      try {
        const redis=await this.connect();
        const count=await redis.incr(key);
        if(count===1) await redis.expire(key, 600);
        if(count>max) throw new HttpException('محاولات كثيرة؛ أعيدي المحاولة بعد عشر دقائق',429);
        return;
      } catch(e) {
        if (e instanceof HttpException) throw e;
        throw new ServiceUnavailableException('خدمة حماية تسجيل الدخول غير متاحة مؤقتًا');
      }
    }
    // Local development fallback only; configure Redis for shared production deployments.
    const now=Date.now();
    if(this.local.size>5000) for(const [k,v] of this.local) if(v.expiry<now) this.local.delete(k);
    const v=this.local.get(key);
    const current = !v || v.expiry<now ? {count:1,expiry:now+600000} : {count:v.count+1,expiry:v.expiry};
    this.local.set(key,current);
    if(current.count>max) throw new HttpException('محاولات كثيرة؛ أعيدي المحاولة بعد عشر دقائق',429);
  }
}

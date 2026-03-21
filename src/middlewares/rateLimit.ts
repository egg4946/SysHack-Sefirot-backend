import { NextFunction, Request, Response } from 'express';

type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  keyFn?: (req: Request) => string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export const createRateLimit = (options: RateLimitOptions) => {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = options.keyFn ? options.keyFn(req) : `${req.ip}:${req.path}`;
    const bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      buckets.set(key, {
        count: 1,
        resetAt: now + options.windowMs,
      });
      next();
      return;
    }

    if (bucket.count >= options.maxRequests) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ detail: 'リクエストが多すぎます。しばらく待って再試行してください' });
      return;
    }

    bucket.count += 1;
    buckets.set(key, bucket);
    next();
  };
};

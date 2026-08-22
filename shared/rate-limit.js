// 进程内滑动窗口限流 —— Pages Function 与 Worker 共用的唯一实现。
// （此前两处逐字拷贝，会各自漂移；本模块是两侧共同的信任边界实现。）
//
// 定位与局限：免费版没有分布式限流绑定，按隔离实例做内存计数——挡住把搜索接口当免费后端
// 高频抓取的脚本够用；防御全网 DDoS 是 Cloudflare 面板 rate limiting rules 的职责。
//
// 桶表回收：每次调用顺带清扫少量过期桶（旋转游标，每调用 8 条），伪造头把表撑大后也能
// 逐步回收；不需要"攒满 N 千条才触发一次全量扫描"。
export function createRateLimiter() {
  const buckets = new Map(); // ip -> { start, count }
  let sweepIter = buckets.entries();

  /**
   * 记录一次请求。
   * @returns 0 = 放行；>0 = 已限流，值为剩余冷却秒数。
   */
  return function checkRateLimit(ip, { max = 120, windowMs = 60000 } = {}) {
    const now = Date.now();
    for (let i = 0; i < 8; i++) {
      const { value, done } = sweepIter.next();
      if (done) { sweepIter = buckets.entries(); break; }
      const [k, b] = value;
      if (now - b.start >= windowMs) buckets.delete(k); // Map 迭代中删除当前项是安全的
    }
    const b = buckets.get(ip);
    if (!b || now - b.start >= windowMs) {
      buckets.set(ip, { start: now, count: 1 });
      return 0;
    }
    b.count++;
    return b.count > max ? Math.ceil((b.start + windowMs - now) / 1000) : 0;
  };
}

// 两侧统一的限流参数解析：RATE_LIMIT_MAX（窗口内最大请求数，默认 120）、
// RATE_LIMIT_WINDOW_SECONDS（窗口秒数，默认 60）。
export function rateLimitConfig(env) {
  return {
    max: Number(env?.RATE_LIMIT_MAX) || 120,
    windowMs: (Number(env?.RATE_LIMIT_WINDOW_SECONDS) || 60) * 1000,
  };
}

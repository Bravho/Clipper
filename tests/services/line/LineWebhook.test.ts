import { createHmac } from 'crypto';
import {
  verifyLineSignature,
  classifyIntent,
  processLineEvent,
  LineWebhookEvent,
} from '@/services/line/LineWebhookService';
import { MockLineAccountRepository } from '@/repositories/mock/MockLineAccountRepository';
import { MockLineClient } from '@/lib/line/MockLineClient';

const SECRET = 'test-line-secret';

function makeSignature(body: string): string {
  return createHmac('sha256', SECRET).update(Buffer.from(body)).digest('base64');
}

describe('verifyLineSignature', () => {
  it('accepts a valid signature', () => {
    const body = '{"events":[]}';
    const sig = makeSignature(body);
    expect(verifyLineSignature(Buffer.from(body), sig, SECRET)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    const body = '{"events":[]}';
    expect(verifyLineSignature(Buffer.from(body), 'bad-sig', SECRET)).toBe(false);
  });

  it('rejects a null/missing signature', () => {
    const body = '{"events":[]}';
    expect(verifyLineSignature(Buffer.from(body), null, SECRET)).toBe(false);
  });

  it('rejects a signature for a different body', () => {
    const sig = makeSignature('original body');
    expect(verifyLineSignature(Buffer.from('tampered body'), sig, SECRET)).toBe(false);
  });
});

describe('classifyIntent', () => {
  const cases: [string, string][] = [
    ['สวัสดี', 'greeting'],
    ['หวัดดีครับ', 'greeting'],
    ['hello', 'greeting'],
    ['ดูแพ็กเกจหน่อย', 'package_info'],
    ['ราคาเท่าไร', 'package_info'],
    ['สถานะงาน', 'status'],
    ['ช่วยเหลือ', 'help'],
    ['help', 'help'],
    ['เริ่มงานเลย', 'start_job'],
    ['ยืนยัน', 'confirm'],
    ['ขอคุยกับคน', 'wants_human'],
    ['คุยกับแอดมิน', 'wants_human'],
    ['human please', 'wants_human'],
    ['xyzabc12345', 'unknown'],
  ];

  test.each(cases)('"%s" → %s', (text, expected) => {
    expect(classifyIntent(text)).toBe(expected);
  });
});

describe('processLineEvent', () => {
  function makeOpts() {
    const lineClient = new MockLineClient();
    const lineAccountRepo = new MockLineAccountRepository(new Map());
    return { lineClient, lineAccountRepo };
  }

  function makeTextEvent(text: string, replyToken = 'rt-001'): LineWebhookEvent {
    return {
      type: 'message',
      message: { type: 'text', text },
      replyToken,
      source: { userId: 'U123' },
    };
  }

  it('replies to greeting (routine) without escalating', async () => {
    const { lineClient, lineAccountRepo } = makeOpts();
    const result = await processLineEvent(makeTextEvent('สวัสดี'), {
      lineChannelId: 'ch-1',
      lineClient,
      lineAccountRepo,
    });
    expect(result.escalated).toBe(false);
    expect(result.intent).toBe('greeting');
    expect(lineClient.sent.filter((s) => s.kind === 'reply')).toHaveLength(1);
  });

  it('replies to package_info without escalating', async () => {
    const { lineClient, lineAccountRepo } = makeOpts();
    const result = await processLineEvent(makeTextEvent('แพ็กเกจ'), {
      lineChannelId: 'ch-1', lineClient, lineAccountRepo,
    });
    expect(result.escalated).toBe(false);
    expect(result.intent).toBe('package_info');
  });

  it('escalates wants_human and replies with escalate message', async () => {
    const { lineClient, lineAccountRepo } = makeOpts();
    const result = await processLineEvent(makeTextEvent('ขอคุยกับคน'), {
      lineChannelId: 'ch-1', lineClient, lineAccountRepo,
    });
    expect(result.escalated).toBe(true);
    expect(result.intent).toBe('wants_human');
    expect(lineClient.sent).toHaveLength(1);
  });

  it('escalates unknown messages and sends fallback reply', async () => {
    const { lineClient, lineAccountRepo } = makeOpts();
    const result = await processLineEvent(makeTextEvent('xyzabc'), {
      lineChannelId: 'ch-1', lineClient, lineAccountRepo,
    });
    expect(result.escalated).toBe(true);
    expect(result.intent).toBe('unknown');
    expect(lineClient.sent).toHaveLength(1);
  });

  it('ignores non-text messages without error', async () => {
    const { lineClient, lineAccountRepo } = makeOpts();
    const event: LineWebhookEvent = {
      type: 'message',
      message: { type: 'image' },
      source: { userId: 'U123' },
    };
    const result = await processLineEvent(event, {
      lineChannelId: 'ch-1', lineClient, lineAccountRepo,
    });
    expect(result.intent).toBe('non_text');
    expect(result.escalated).toBe(false);
    expect(lineClient.sent).toHaveLength(0);
  });

  it('handles events with no userId gracefully', async () => {
    const { lineClient, lineAccountRepo } = makeOpts();
    const event: LineWebhookEvent = {
      type: 'message',
      message: { type: 'text', text: 'สวัสดี' },
      source: {},
    };
    const result = await processLineEvent(event, {
      lineChannelId: 'ch-1', lineClient, lineAccountRepo,
    });
    expect(result.intent).toBe('no_user');
    expect(lineClient.sent).toHaveLength(0);
  });

  it('does NOT reply when replyToken is absent', async () => {
    const { lineClient, lineAccountRepo } = makeOpts();
    const event: LineWebhookEvent = {
      type: 'message',
      message: { type: 'text', text: 'สวัสดี' },
      source: { userId: 'U123' },
      // no replyToken
    };
    await processLineEvent(event, { lineChannelId: 'ch-1', lineClient, lineAccountRepo });
    expect(lineClient.sent).toHaveLength(0);
  });
});

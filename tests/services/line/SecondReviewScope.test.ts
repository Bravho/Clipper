import { LineIntakeService } from '@/services/line/LineIntakeService';
import { PostgresServicePackageRepository } from '@/repositories/postgres/PostgresServicePackageRepository';
import { PostgresReviewOutboxRepository } from '@/repositories/postgres/PostgresReviewOutboxRepository';
jest.mock('@/lib/db', () => ({ pool: {} }));
const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });
function intake(accountTest: boolean, orderTest: boolean) {
  const accounts = { findByLineUser: jest.fn().mockResolvedValue({ userId: 'u', isTest: accountTest, status: 'active' }) };
  const order = { id: 'o', userId: 'u', isTest: orderTest, status: 'active', expiresAt: new Date(Date.now()+86400000) };
  const packages = { createOrder: jest.fn().mockResolvedValue(order), findOrderById: jest.fn().mockResolvedValue(order),
    findActiveOrderByUser: jest.fn().mockResolvedValue(order), getBalance: jest.fn().mockResolvedValue({ clipsLeft: 2 }) };
  return { packages, service: new LineIntakeService('ch', accounts as never, {} as never, packages as never, {} as never, {} as never) };
}
test.each(['LINE_TEST_MODE', 'LINE_TEST_SHOP_ID'])('test scope %s rejects real account without granting', async key => {
  delete process.env.LINE_TEST_MODE; delete process.env.LINE_TEST_SHOP_ID;
  process.env[key] = key === 'LINE_TEST_MODE' ? 'true' : 'shop';
  const {service, packages} = intake(false, true);
  await expect(service.choosePackage('shop', 'starter')).rejects.toThrow('test_account_scope_mismatch');
  expect(packages.createOrder).not.toHaveBeenCalled();
});
test.each([false, true])('order lookup and payment reject opposite scope, mode=%s', async mode => {
  process.env.LINE_TEST_MODE=String(mode); delete process.env.LINE_TEST_SHOP_ID;
  const {service, packages} = intake(mode, !mode);
  expect(await service.isPaid('o', 'shop')).toBe(false);
  expect(await service.findActiveOrderWithBalance('shop')).toBeNull();
  expect(packages.findActiveOrderByUser).toHaveBeenCalledWith('u', mode);
});
test.each([false,true])('postgres lookup uses exact scope %s', async mode => {
  const query=jest.fn().mockResolvedValue({rows:[]});
  await new PostgresServicePackageRepository({query} as never).findActiveOrderByUser('u',mode);
  expect(query.mock.calls[0][0]).toContain('is_test=$2::boolean');
  expect(query.mock.calls[0][1]).toEqual(['u',mode]);
});
test.each(['clip','revision'] as const)('consumption rejects mismatched persisted request before usage or idempotent return: %s', async kind => {
  const query=jest.fn().mockResolvedValue({rows:[]});
  const repo=new PostgresServicePackageRepository({connect:async()=>({query,release:jest.fn()})} as never);
  await expect(repo.recordUsage({requestId:'r',packageOrderId:'o',kind})).rejects.toThrow('package_scope_mismatch');
  expect(query.mock.calls[1][0]).toContain('cr.user_id=po.user_id AND cr.is_test=po.is_test');
  expect(query.mock.calls.map(c=>c[0]).some(s=>s.includes('INSERT'))).toBe(false);
  expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
});
test.each([false,true])('outbox SQL requires authoritative owner equality in both modes: %s', async mode => {
  process.env.LINE_TEST_MODE=String(mode);
  const query=jest.fn().mockResolvedValue({rows:[]});
  await new PostgresReviewOutboxRepository({query} as never).claimNext();
  const [sql,params]=query.mock.calls[0];
  expect(params).toEqual([mode]);
  expect(sql).toContain('COALESCE(cr.is_test, po.is_test,');
  expect(sql).toContain('ri.package_order_id::text');
  expect(sql).toContain('= $1::boolean');
  expect(sql).not.toContain('$1::boolean = false OR');
  expect(sql).not.toContain("payload->>'is_test'");
});
test('schema preflight rejects extra restrictions and wrong keys using fake db only', async () => {
  const {checkPhase2Schema}=require('../../../scripts/check-phase2-schema.cjs');
  const rows=['test','all'].map(kind=>({name:`uq_render_tasks_active_${kind}_job`,indisunique:true,indisvalid:true,key:'job_id',indnkeyatts:1,indnatts:1,
    predicate:`(state = ANY (ARRAY[${(kind==='test'?['test_queued','test_claimed']:['queued','claimed','test_queued','test_claimed']).map(s=>`'${s}'::text`).join(', ')}]))`}));
  await expect(checkPhase2Schema({query:async()=>({rows})})).resolves.toBeUndefined();
  for(const change of [{predicate:rows[1].predicate+" AND device_only=false"},{key:'request_id'},{indnkeyatts:2},{indnatts:2},{predicate:"state IN ('queued','claimed','test_queued','test_claimed','done')"}]) {
    await expect(checkPhase2Schema({query:async()=>({rows:[rows[0],{...rows[1],...change}]})})).rejects.toThrow('prerequisite');
  }
});
test.each(['false', 'TRUE', '', 'true'])('real shops bypass payment only when PAYMENT_DISABLED is exactly true: %s', async disabled => {
  process.env.LINE_TEST_MODE='false'; delete process.env.LINE_TEST_SHOP_ID;
  process.env.PAYMENT_DISABLED=disabled;
  const {service,packages}=intake(false,false);
  const result=await service.choosePackage('shop','starter');
  const input=packages.createOrder.mock.calls[0][0];
  expect(input.isTest).toBe(false);
  expect(input.activationReference).toBe(disabled==='true'?'payment_disabled':undefined);
  expect(result.paymentUrl===null).toBe(disabled==='true');
});
test.each(['LINE_TEST_MODE','LINE_TEST_SHOP_ID'])('matching test account can receive free test order with %s',async key=>{
  delete process.env.LINE_TEST_MODE; delete process.env.LINE_TEST_SHOP_ID;
  process.env[key]=key==='LINE_TEST_MODE'?'true':'shop'; process.env.PAYMENT_DISABLED='false';
  const {service,packages}=intake(true,true);
  expect((await service.choosePackage('shop','starter')).paymentUrl).toBeNull();
  expect(packages.createOrder.mock.calls[0][0]).toMatchObject({isTest:true,activationReference:'payment_disabled'});
  expect(await service.isPaid('o','shop')).toBe(true);
});
test('storyboard render/voice owner is resolved through persisted version request, not payload scope',async()=>{
  const query=jest.fn().mockResolvedValue({rows:[]});
  await new PostgresReviewOutboxRepository({query} as never).claimNext();
  const sql=query.mock.calls[0][0];
  expect(sql).toContain("LEFT JOIN storyboard_versions sv ON sv.id::text=review_outbox.payload->>'version_id'");
  expect(sql).toContain('sv.request_id::text, vj.request_id::text');
});

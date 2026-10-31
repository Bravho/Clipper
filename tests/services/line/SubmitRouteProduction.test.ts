jest.mock('next-auth', () => ({ getServerSession: jest.fn(async () => ({ user: { id: 'u', role: 'requester' } })) }));
jest.mock('@/lib/auth/authOptions', () => ({ authOptions: {} }));
jest.mock('@/services/ClipRequestService', () => ({ clipRequestService: {
  getOwnedRequest: jest.fn(), submitRequest: jest.fn(), markRenderedOnDevice: jest.fn() } }));
jest.mock('@/services/VideoGenerationService', () => ({ videoGenerationService: {
  getCurrentJob: jest.fn(async () => null), initializePipeline: jest.fn(async () => ({ id: 'job' })) } }));
jest.mock('@/repositories/index', () => ({ uploadedAssetRepository: { findByRequestId: jest.fn(async () => []) } }));
jest.mock('@/services/LocalMediaDerivativeService', () => ({ storeLocalMediaDerivatives: jest.fn() }));
import { POST } from '@/app/api/requests/[id]/submit/route';
import { clipRequestService } from '@/services/ClipRequestService';
import { RequestStatus } from '@/domain/enums/RequestStatus';
const service = clipRequestService as jest.Mocked<typeof clipRequestService>;
afterEach(() => { delete process.env.STUDIO_ONLY; jest.clearAllMocks(); });
test.each(['studio', 'web', undefined])('STUDIO_ONLY still rejects app draft %s before submission', async channel => {
  process.env.STUDIO_ONLY = 'true';
  service.getOwnedRequest.mockResolvedValue({ id: 'r', intakeChannel: channel, status: RequestStatus.Draft } as never);
  const response = await POST(new Request('http://localhost/api/requests/r/submit', { method: 'POST',
    body: JSON.stringify({ creditConfirmed: true, rightsConfirmed: true, aiProcessingConfirmed: true }) }), { params: Promise.resolve({ id: 'r' }) });
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe('app_update_required');
  expect(service.submitRequest).not.toHaveBeenCalled();
});
test('LINE marker reaches real submit handler and bypasses STUDIO_ONLY', async () => {
  process.env.STUDIO_ONLY = 'true';
  const request = { id: 'r', intakeChannel: 'line', userId: 'u', status: RequestStatus.Draft, durationSeconds: 15, targetPlatforms: [] };
  service.getOwnedRequest.mockResolvedValue(request as never);
  service.submitRequest.mockResolvedValue(request as never);
  const response = await POST(new Request('http://localhost/api/requests/r/submit', { method: 'POST',
    body: JSON.stringify({ creditConfirmed: true, rightsConfirmed: true, aiProcessingConfirmed: true }) }), { params: Promise.resolve({ id: 'r' }) });
  expect(response.status).toBe(200);
  expect(service.submitRequest).toHaveBeenCalledWith('r','u',true,true,true);
});

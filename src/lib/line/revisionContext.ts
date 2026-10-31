import { AsyncLocalStorage } from 'async_hooks';
const context = new AsyncLocalStorage<boolean>();
export const hasReservedLineRevision = () => context.getStore() === true;
export const withReservedLineRevision = <T>(work: () => Promise<T>): Promise<T> => context.run(true, work);

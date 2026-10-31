import { AsyncLocalStorage } from 'async_hooks';
const context = new AsyncLocalStorage<boolean>();
export const isPrivateLineStorage = () => context.getStore() === true;
export function withLineStorage<T>(line: boolean, work: () => Promise<T>): Promise<T> {
  return context.run(line, work);
}

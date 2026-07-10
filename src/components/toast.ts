import { useStore } from '../store';

export function showToast(msg: string) {
  useStore.getState().showToast(msg);
}
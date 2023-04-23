
import { Position, getCurrentLocationTracker } from './location-tracker';

export enum AbnormalState {
  ERROR,
  WARNING
}

export type AbnormalStateListener = (type: AbnormalState, msg: string, range: Position[]) => void;

let listener: AbnormalStateListener = onAbnormalStateReceive;

function onAbnormalStateReceive(type: AbnormalState, msg: string, range: Position[]): void {
  const { line, column } = range[0];
  throw new Error(`${msg}, at ${line}:${column}`);
}

function notifyError(msg: string) {
  const tracker = getCurrentLocationTracker();
  listener?.(AbnormalState.ERROR, msg, [
    tracker.getCurrentStartPosition(),
    tracker.getCurrentEndPosition()
  ]);
}

function notifyWarning(msg: string) {
  const tracker = getCurrentLocationTracker();
  listener?.(AbnormalState.WARNING, msg, [
    tracker.getCurrentStartPosition(),
    tracker.getCurrentEndPosition()
  ]);
}

function setAbnormalStateReceiveListener(value: AbnormalStateListener) {
  listener = value;
}

export {
  notifyError,
  notifyWarning,
  setAbnormalStateReceiveListener
};
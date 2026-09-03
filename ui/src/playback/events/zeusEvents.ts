import { GameEvent } from "./gameEvent";
import type {
  ZeusCameraPayload,
  ZeusEntityPayload,
  ZeusRemoteControlPayload,
} from "../../data/types";

export class ZeusEntityEvent extends GameEvent {
  constructor(
    frameNum: number,
    id: number,
    public readonly payload: ZeusEntityPayload,
  ) {
    super(frameNum, "zeusEntity", id);
  }

  get curatorId(): number {
    return this.payload.curatorId;
  }
}

export class ZeusRemoteControlEvent extends GameEvent {
  constructor(
    frameNum: number,
    id: number,
    public readonly payload: ZeusRemoteControlPayload,
  ) {
    super(frameNum, "zeusRemoteControl", id);
  }
}

export class ZeusCameraEvent extends GameEvent {
  constructor(
    frameNum: number,
    id: number,
    public readonly payload: ZeusCameraPayload,
  ) {
    super(frameNum, "zeusCamera", id);
  }
}

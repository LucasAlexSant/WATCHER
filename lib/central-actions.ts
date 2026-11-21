export type MapBounds = [[number, number], [number, number]];

export type MapMove =
  | { kind: 'country' }
  | { kind: 'center'; center: [number, number]; zoom: number }
  | { kind: 'bounds'; bounds: MapBounds }
  | { kind: 'zoom'; delta: -1 | 1 };

export type CentralAction =
  | { kind: 'map'; move: MapMove; message: string }
  | { kind: 'incident'; incidentId: string; move: MapMove | null; message: string };

export type CentralEvent = { cursor: string; action: CentralAction };
export type MapInstruction = { sequence: number; move: MapMove };

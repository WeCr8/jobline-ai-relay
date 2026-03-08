/**
 * types.ts — canonical JobLine domain types (self-contained copy)
 *
 * This is the single source of truth inside jobline-relay.
 * The same types are published separately as @jobline/shared for consumers.
 * When @jobline/shared changes, update this file to match.
 */

// ── Machine identity & state ──────────────────────────────────────────────────

export type ControlType     = 'fanuc' | 'haas' | 'siemens' | 'mazak' | 'okuma';
export type ConnectionType  = 'serial' | 'ethernet' | 'mtconnect';
export type ConnectionStatus= 'disconnected' | 'connecting' | 'connected' | 'error';
export type MachineState    = 'idle' | 'running' | 'feed-hold' | 'alarm' | 'estop' | 'unknown';
export type MachineMode     = 'auto' | 'mdi' | 'manual' | 'edit' | 'jog' | 'unknown';
export type TransferDirection = 'send' | 'receive';
export type TransferStatus    = 'queued' | 'active' | 'complete' | 'failed' | 'cancelled';

export interface MachineIdentity {
  id: string;
  label: string;
  controlType: ControlType;
  connectionType: ConnectionType;
}

export interface MachineStatusSnapshot {
  machineId: string;
  connectionStatus: ConnectionStatus;
  machineState: MachineState;
  machineMode: MachineMode;
  spindleRpm: number | null;
  spindleOverride: number | null;
  feedOverride: number | null;
  activeTool: number | null;
  activeProgram: string | null;
  blockNumber: number | null;
  position: { x?: number; y?: number; z?: number; a?: number; b?: number };
  alarms: AlarmEntry[];
  timestamp: string; // ISO-8601
}

export interface AlarmEntry {
  code: string;
  message: string;
  severity: 'warning' | 'alarm' | 'fault';
  timestamp: string; // ISO-8601
}

export interface TransferRecord {
  id: string;
  machineId: string;
  direction: TransferDirection;
  filePath: string;
  programName: string;
  status: TransferStatus;
  bytesTotal: number;
  bytesTransferred: number;
  bytesPerSec?: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

// ── Event bus ─────────────────────────────────────────────────────────────────

export type JobLineEventType =
  | 'machine.connected'
  | 'machine.disconnected'
  | 'machine.status'
  | 'machine.alarm'
  | 'machine.reconnecting'
  | 'transfer.started'
  | 'transfer.progress'
  | 'transfer.complete'
  | 'transfer.failed'
  | 'gcode.validated'
  | 'session.started'
  | 'session.ended';

export interface JobLineEvent<T = unknown> {
  seq: number;
  type: JobLineEventType;
  machineId: string;
  sessionId: string;
  payload: T;
  timestamp: string; // ISO-8601
}

/** Wire envelope — wraps JobLineEvent for WebSocket framing */
export interface RelayMessage {
  v: 1;
  tenantId: string;
  event: JobLineEvent;
}

/** Subscription filter sent by subscriber on connect */
export interface DashboardSubscription {
  machineIds: string[];
  eventTypes: JobLineEventType[];
}

export interface WPPStore {
  sessionExists(sessionName: string): Promise<boolean>;

  load(sessionName: string): Promise<Buffer | null>;

  save(sessionName: string, data: Buffer): Promise<void>;

  delete(sessionName: string): Promise<void>;
}

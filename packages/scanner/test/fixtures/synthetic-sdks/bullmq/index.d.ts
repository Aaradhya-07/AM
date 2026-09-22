// SYNTHETIC TEST DECLARATIONS for the ANVILMARK scanner test suite.
// This is NOT the bullmq npm package. It mirrors only the declaration shape the
// scanner's recognizer relies on, contains no implementation, and is copied
// into a temporary node_modules/ by the tests.
export interface Job<T = any> {
  data: T;
}

export declare class Queue<T = any> {
  constructor(name: string);
  add(name: string, data: T): Promise<{ id: string }>;
}

export declare class Worker<T = any> {
  constructor(name: string, processor: (job: Job<T>) => Promise<unknown>);
}

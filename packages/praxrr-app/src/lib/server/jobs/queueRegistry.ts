import type { JobHandler, JobType } from './queueTypes.ts';

class JobQueueRegistry {
  private handlers = new Map<JobType, JobHandler>();

  register(jobType: JobType, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  get(jobType: JobType): JobHandler | undefined {
    return this.handlers.get(jobType);
  }

  getAll(): Array<{ jobType: JobType; handler: JobHandler }> {
    return Array.from(this.handlers.entries()).map(([jobType, handler]) => ({
      jobType,
      handler,
    }));
  }
}

export const jobQueueRegistry = new JobQueueRegistry();

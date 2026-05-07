import type { Project } from '../types';

export function serializeProjectForDirty(project: Project): string {
  return JSON.stringify(project);
}

export function isProjectDirty(project: Project, lastSavedProjectJSON: string): boolean {
  return serializeProjectForDirty(project) !== lastSavedProjectJSON;
}

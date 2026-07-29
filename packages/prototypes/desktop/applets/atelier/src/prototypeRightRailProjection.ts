import type {
  AtelierProjectProjection,
  Task,
  TaskContext,
  TodoItem,
} from './types';

export type PrototypeRightRailProjection =
  | {
      surface: 'project';
      selectedProject: AtelierProjectProjection;
      todos: TodoItem[];
      context?: TaskContext;
    }
  | {
      surface: 'legacyTodo';
      todos: TodoItem[];
      context?: TaskContext;
    }
  | {
      surface: 'empty';
      todos: TodoItem[];
      context?: TaskContext;
    };

export function derivePrototypeRightRailProjection(input: {
  selectedTaskId: string;
  selectedTask?: Task;
  projects?: AtelierProjectProjection[];
  todosByTaskId: Record<string, TodoItem[] | undefined>;
  contextByTaskId: Record<string, TaskContext | undefined>;
}): PrototypeRightRailProjection {
  const todos = input.todosByTaskId[input.selectedTaskId] ?? [];
  const context = input.contextByTaskId[input.selectedTaskId];
  const selectedProject = input.projects?.find((project) =>
    project.id === input.selectedTask?.projectId ||
    project.taskGraph.tasks.some((node) => node.id === input.selectedTaskId),
  );

  if (selectedProject) {
    return {
      surface: 'project',
      selectedProject,
      todos,
      context,
    };
  }

  if (todos.length > 0) {
    return {
      surface: 'legacyTodo',
      todos,
      context,
    };
  }

  return {
    surface: 'empty',
    todos,
    context,
  };
}

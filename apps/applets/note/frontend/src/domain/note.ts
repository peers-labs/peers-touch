export interface Note {
  noteId: string;
  ownerId: string;
  title: string;
  content: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
}

export interface NotePage {
  items: Note[];
  nextPageToken: string;
}

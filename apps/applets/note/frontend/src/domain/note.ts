export interface Note {
  noteId: string;
  ownerPtid: string;
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

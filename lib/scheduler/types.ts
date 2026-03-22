export type ParticipantAvailability = {
  id: string;
  name: string;
  updatedAt: string;
  dates: string[];
};

export type BoardWindow = {
  start: string;
  end: string;
};

export type PublicBoardResponse = {
  configured: boolean;
  message?: string;
  participants: ParticipantAvailability[];
  window: BoardWindow;
};

export type SessionPayload = {
  participantId: string;
  editorToken: string;
  name: string;
};

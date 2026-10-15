// Sample incoming orders, the way they actually arrive on a wholesaler's WhatsApp.

export type Channel = 'text' | 'voice' | 'photo';

export interface InboxMessage {
  id: string;
  partyId: string;
  channel: Channel;
  minutesAgo: number;
  text: string;          // message text, voice transcript or photo transcription
  durationSec?: number;  // voice notes
  photo?: 'sample-parchi';
}

export const INBOX: InboxMessage[] = [
  {
    id: 'M1', partyId: 'P01', channel: 'text', minutesAgo: 4,
    text: 'Hola, necesito 2 cajas de grapadoras 24/6, 5 docenas de papel de regalo rojo, 10 paquetes de grapas 24/6 y 6 rollos de cinta de embalaje. Para mañana por favor 🙏',
  },
  {
    id: 'M2', partyId: 'P06', channel: 'voice', minutesAgo: 11, durationSec: 19,
    text: 'haan bhai, woh pechkas set das set bhejna, aur plaas ek dozen, hathoda chhota wala chhe piece, aur taala 50mm ek dabba',
  },
  {
    id: 'M3', partyId: 'P02', channel: 'text', minutesAgo: 23,
    text: 'Olá, preciso de 3 dúzias de mamadeiras 250ml, 2 caixas de lenços umedecidos e 20 pacotes de fraldas médias. Amanhã, por favor',
  },
  {
    id: 'M4', partyId: 'P03', channel: 'text', minutesAgo: 38,
    text: 'السلام عليكم، عايز ٢ كرتونة لمبة ليد 9W، ١٠ مشترك 4 socket، و ٥ علب بطارية AA',
  },
  {
    id: 'M5', partyId: 'P07', channel: 'photo', minutesAgo: 52, photo: 'sample-parchi',
    text: 'Stapler No.10 - 2 box\nCello tape - 3 dz\nGel pen - 100\nGeometry box - 12\nSharpner - 5 box',
  },
  {
    id: 'M6', partyId: 'P04', channel: 'text', minutesAgo: 75,
    text: 'Hi pls send 100 pcs ball pen blue, 50 notbook 200pg, 2 doz sciccors, 6 padlok 40mm, 1 box pensil',
  },
  {
    id: 'M7', partyId: 'P05', channel: 'text', minutesAgo: 96,
    text: "Comme la dernière fois — 24 cadres photo 6x8, une douzaine d'horloges murales, 10 ours en peluche 12 inch, 100 papier cadeau",
  },
];

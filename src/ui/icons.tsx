import React from 'react';

type P = { className?: string };
const S = (d: React.ReactNode) => ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

export const IconDesk = S(<><path d="M4 5h16v10H4z" /><path d="M4 15l3 4h10l3-4" /><path d="M8 9h8M8 12h5" /></>);
export const IconBills = S(<><path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z" /><path d="M9 8h6M9 12h6M9 16h3" /></>);
export const IconStock = S(<><path d="M3 9l9-5 9 5-9 5z" /><path d="M3 9v7l9 5 9-5V9" /><path d="M12 14v7" /></>);
export const IconInsights = S(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>);
export const IconPlans = S(<><path d="M3 12l9-9h8v8l-9 9z" /><circle cx="15.5" cy="8.5" r="1.5" /></>);
export const IconText = S(<><path d="M4 5h16v11H9l-5 4z" /></>);
export const IconVoice = S(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></>);
export const IconPhoto = S(<><path d="M3 7h4l2-3h6l2 3h4v13H3z" /><circle cx="12" cy="13" r="3.5" /></>);
export const IconCheck = S(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconAlert = S(<><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>);
export const IconInfo = S(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>);
export const IconDownload = S(<><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></>);
export const IconCopy = S(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" /></>);
export const IconSun = S(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IconMoon = S(<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />);
export const IconReset = S(<><path d="M4 12a8 8 0 108-8" /><path d="M4 4v5h5" /></>);
export const IconTrash = S(<><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>);
export const IconClose = S(<path d="M6 6l12 12M18 6L6 18" />);
export const IconSearch = S(<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4-4" /></>);
export const IconStamp = S(<><path d="M9 3h6v6l3 4H6l3-4z" /><path d="M4 17h16v4H4z" /></>);
export const IconPlay = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>
);
export const IconWand = S(<><path d="M4 20L16 8M14 6l4 4" /><path d="M18 3v3M16.5 4.5h3M20 12v2M19 13h2M8 3v2M7 4h2" /></>);
export const IconShip = S(<><path d="M3 15l2 5h14l2-5z" /><path d="M5 15V9h14v6M9 9V5h6v4" /></>);
export const IconPlus = S(<path d="M12 5v14M5 12h14" />);

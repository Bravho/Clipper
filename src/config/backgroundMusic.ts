export interface MusicTrack {
  id: string;
  label: string;
  url: string;
}

export const BACKGROUND_MUSIC_TRACKS: MusicTrack[] = [
  { id: "action-sport",        label: "Action Sport",        url: "/music/action-sport.mp3" },
  { id: "action-trailer",      label: "Action Trailer",      url: "/music/action-trailer.mp3" },
  { id: "carnival",            label: "Carnival",            url: "/music/carnival.mp3" },
  { id: "dance-playful",       label: "Dance Playful",       url: "/music/dance-playful.mp3" },
  { id: "energy",              label: "Energy",              url: "/music/energy.mp3" },
  { id: "happy",               label: "Happy",               url: "/music/happy.mp3" },
  { id: "hip-hop",             label: "Hip Hop",             url: "/music/hip-hop.mp3" },
  { id: "inspiring-cinematic", label: "Inspiring Cinematic", url: "/music/inspiring-cinematic.mp3" },
  { id: "motivation-rock",     label: "Motivation Rock",     url: "/music/motivation-rock.mp3" },
  { id: "no-sleep",            label: "No Sleep",            url: "/music/no-sleep.mp3" },
  { id: "promotion",           label: "Promotion",           url: "/music/promotion.mp3" },
  { id: "spring-mothers",      label: "Spring Mothers",      url: "/music/spring-mothers.mp3" },
  { id: "starostin-comedy",    label: "Comedy",              url: "/music/starostin-comedy.mp3" },
];

const BASE = 'https://fweeyjnqwxywmpmnqpts.supabase.co/storage/v1/object/public/SweetDreamsMusicPictures';

export const STUDIO_IMAGES = {
  // Wide — hero backgrounds, full-width sections
  adamSpeakersWide: `${BASE}/adamaudiospeakerswide.jpg`,
  adamCloseupWide: `${BASE}/adamaudiowidecloseup.jpg`,
  akgMicWide: `${BASE}/AKGMicWide.jpg`,
  ayeGBoothWide: `${BASE}/ayegboothwide.jpg`,
  bockMicWide: `${BASE}/BocAudioMicWide.jpg`,
  iszacStudioAWide: `${BASE}/iszacstudioawide.jpg`,
  jayBoothWide: `${BASE}/Jayboothwide.jpg`,
  jayIszacPrvrbStudioAWide: `${BASE}/jayiszacprvrbstudioawide.jpg`,
  jayStudioBWritingWide: `${BASE}/JayStudioBwritingwide.jpg`,
  prvrbBoothWide: `${BASE}/prvrbboothwide.jpg`,
  prvrbTopStudioAWide: `${BASE}/prvrbtopstudioawide.jpg`,
  studioBSideLowAngleWide: `${BASE}/studiobrightsidelowanglewide.jpg`,
  studioBRightSideSpeakers: `${BASE}/studiobrightsidespeakers.jpg`,
  studioBStraightOnWide: `${BASE}/StudiobstraightonWide.jpg`,
  studioBStraightOnWide2: `${BASE}/studiobstraightonWide2.jpg`,
  studioBWide: `${BASE}/studiobwide.jpg`,
  topBoothCloseupWide: `${BASE}/Topcloseupboothwide.jpg`,
  topStudioAFocusedWide: `${BASE}/TopstudioAfocusedwide.jpg`,
  mojaveWide: `${BASE}/MojaveWide.jpg`,

  // Square — cards, thumbnails
  doloBoothSquare: `${BASE}/dolocloseupboothsquare.jpg`,
  doloWindowSquare: `${BASE}/DoloWindowsquare.jpg`,

  // Vertical — featured sections, side panels
  iszacVert: `${BASE}/IszacVert.jpg`,
  jayTopStudioBVert: `${BASE}/JayTopstudiobboothVert.jpg`,
  jebJayStudioAVert: `${BASE}/JebJaystudioavert.jpg`,
  prvrbBoothGlowVert: `${BASE}/prvrbboothglowvert.jpg`,
  prvrbStudioAVert: `${BASE}/prvrbstudioavert.jpg`,
  prvrbJebVert: `${BASE}/prvrbjebvert.jpg`,
  zLaughingStudioBVert: `${BASE}/Zlaughingstudiobvert.jpg`,
  zStudioBVert: `${BASE}/ZstudioBVert.jpg`,
  topBoothCloseupVert: `${BASE}/Topboothcloseupvert.jpg`,
  topBoothVert: `${BASE}/TopBoothVert.jpg`,
  topBoothVert2: `${BASE}/Topboothvert2.jpg`,

  // Graphics / Closeups — equipment showcase
  akgCloseup: `${BASE}/akgcloseup.jpg`,
  akgGraphic: `${BASE}/akggraphic.jpg`,
  bockMicCloseup: `${BASE}/bockMiccloseup.jpg`,
  bockGraphic: `${BASE}/bockgraphic.jpg`,
  manleyGraphic: `${BASE}/manleygraphic.jpg`,
  mojaveGraphic: `${BASE}/mojavegraphic.jpg`,
} as const;

// Sweet Spot stills (Supabase Storage bucket `SweetSpot`). The media-era
// marketing pages (home / about / recording) lean on these — they're the only
// photos in the library that show video production rather than recording.
// Same files app/bands/page.tsx renders in its gallery.
const SWEET_SPOT_BASE = 'https://fweeyjnqwxywmpmnqpts.supabase.co/storage/v1/object/public/SweetSpot';
export const SWEET_SPOT_IMAGES = {
  logo: `${SWEET_SPOT_BASE}/sweetspotLogo.png`,
  fullBand: `${SWEET_SPOT_BASE}/Timeline 1_01_00_26_07.jpg`,
  vocalist: `${SWEET_SPOT_BASE}/Timeline 1_01_01_47_18.jpg`,
  instrument: `${SWEET_SPOT_BASE}/Timeline 1_01_02_47_11.jpg`,
  wide: `${SWEET_SPOT_BASE}/Timeline 1_01_03_05_09.jpg`,
  drummer: `${SWEET_SPOT_BASE}/Timeline 1_01_03_54_18.jpg`,
  performance: `${SWEET_SPOT_BASE}/Timeline 1_01_07_24_17.jpg`,
  liveMoment: `${SWEET_SPOT_BASE}/Timeline 1_01_07_50_14.jpg`,
  finalFrame: `${SWEET_SPOT_BASE}/Timeline 1_01_08_42_14.jpg`,
} as const;

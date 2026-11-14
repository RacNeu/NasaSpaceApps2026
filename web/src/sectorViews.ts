/**
 * Where the camera frames each sector. A sector's data box covers every detection, but for big
 * countries that includes empty Arctic or ocean, so the globe frames the part where fires happen.
 */
export const VIEW_BOX: Record<string, [number, number, number, number]> = {
  mainland_sea: [92, 8, 110, 27],
  australia: [113, -40, 154, -11],
  brazil: [-74, -34, -34, 6],
  united_states: [-126, 24, -66, 50],
  canada: [-136, 44, -56, 66],
};

export const viewBox = (meta: { box: [number, number, number, number]; sector?: { id: string } }) =>
  (meta.sector && VIEW_BOX[meta.sector.id]) || meta.box;

/**
 * The squirrel. One drawing, used everywhere.
 *
 * Consistency is the whole point, so there is exactly one set of coordinates
 * in this file and every appearance is a crop of it. The tab-bar icon is not a
 * simplified squirrel that resembles the big one — it is the same squirrel with
 * a tighter viewBox. Nothing can drift out of sync because there is nothing to
 * keep in sync.
 *
 * What makes the drawing read as a squirrel rather than a mouse is the tail,
 * and it has to be enormous: taller than she is, wider than her body, arcing up
 * behind and curling forward over her head. A modest tail turns her into a
 * hamster no matter how good the rest of the anatomy is. Everything else — the
 * small round head, the short blunt muzzle, the upright sit with the weight in
 * the haunch — is in service of that silhouette.
 *
 * Drawn in parts rather than as one shape because she has to move: an ear that
 * twitches and a tail that sways have to be their own elements.
 *
 * The body carries a paper-coloured halo (`paint-order: stroke fill`) so it
 * knocks a clean gap out of the tail behind it. Without that, tail and body
 * merge into one blob at any size below about 40px.
 */

/**
 * Crops onto the single drawing below. Chosen so the silhouette stays
 * recognisable as each one gets smaller. Even `portrait` keeps both ears and a
 * slice of the tail, because a round head on its own is any rodent at all.
 */
const FRAME = { full: "0 0 64 64", bust: "4 0 44 44", portrait: "6 0 34 34" };

export default function Squirrel({
  size = 24,
  crop = "full",
  pose = "idle",
  className = "",
  title,
}) {
  return (
    <svg
      viewBox={FRAME[crop]}
      width={size}
      height={size}
      className={`sq-squirrel sq-${pose} ${className}`}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}

      {/* ---- tail: the whole silhouette. Rises off the rump, sweeps right and
           up, curls forward over her head. Outer edge is deliberately lobed so
           it reads as fur rather than a smooth crescent. */}
      <g className="sq-tail">
        <path
          className="sq-fill"
          d="M39 59
             C47 59 53 55 56 49
             C59 44 60 38 58 33
             C61 28 60 21 56 16
             C53 11 48 8 43 7
             C38 6 33 8 31 12
             C34 12 38 14 41 18
             C45 23 47 30 45 36
             C43 42 39 46 37 51
             C36 54 36 57 39 59 Z"
        />
        {/* Fur direction. Three strokes following the sweep, thin enough to
            vanish rather than smear when she is 18px tall. */}
        <path className="sq-hair" d="M50 48c4-5 6-12 4-18M54 40c2-6 2-13-1-18M44 53c3-3 5-7 6-11" />
      </g>

      {/* ---- her, from the ground up. One group so the halo is continuous. */}
      <g className="sq-body">
        {/* haunch and hind foot: the weight sits low and to the front */}
        <path
          className="sq-fill sq-halo"
          d="M22 34
             C16 37 13 44 14 50
             C15 56 20 59 27 59
             L36 59
             C40 59 41 56 39 53
             C36 49 35 44 35 39
             C35 35 30 32 22 34 Z"
        />
        <path
          className="sq-fill sq-halo"
          d="M13 54c-3 0-5 1-5 3 0 2 2 3 5 3h9c2 0 3-1 3-2 0-2-2-3-5-3z"
        />
      </g>

      {/* ---- forelegs, tucked at the chest where a squirrel always holds them */}
      <g className="sq-paws">
        <path className="sq-fill" d="M18 35c-2 1-4 3-4 5 0 2 2 4 4 4 2 0 4-2 4-4 0-2-2-5-4-5z" />
      </g>

      {/* ---- ears: tall and tufted, the near one flicks */}
      <g className="sq-head">
        <path className="sq-fill sq-halo sq-ear-far" d="M29 11c0-5 2-9 4-9 2 0 3 4 2 8-1 3-3 5-6 6z" />
        <path className="sq-fill sq-halo sq-ear" d="M18 11c-1-5-4-9-6-8-2 1-1 5 1 8 1 3 3 5 5 5z" />

        {/* head: small and round, with a short blunt muzzle. A long snout is a
            rat; a big head is a hamster. */}
        <path
          className="sq-fill sq-halo"
          d="M23 7
             C16 7 11 12 11 19
             C11 22 12 24 13 26
             C11 27 10 28 10 29
             C10 30 11 31 13 31
             C15 31 17 30 18 29
             C20 30 22 31 24 31
             C30 31 34 26 34 20
             C34 12 29 7 23 7 Z"
        />
        {/* eye: knocked out of the fill, so it survives to the smallest size */}
        <circle className="sq-eye" cx="18" cy="17" r="2.7" />
        <circle className="sq-glint" cx="19.1" cy="15.9" r="0.9" />
        {/* nose, at the tip of the muzzle rather than under it */}
        <circle className="sq-fill" cx="10.5" cy="28.5" r="1.5" />
        {/* whiskers: what makes it an animal rather than a shape */}
        <path className="sq-whisker" d="M9 27L3 24M9 29L2 29M10 31L5 34" />
      </g>
    </svg>
  );
}

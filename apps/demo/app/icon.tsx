import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
        }}
      >
        <span
          style={{
            color: '#F4C430',
            fontSize: 20,
            fontWeight: 900,
            fontFamily: 'Impact, Arial Black, sans-serif',
            lineHeight: 1,
          }}
        >
          SD
        </span>
      </div>
    ),
    { ...size }
  );
}

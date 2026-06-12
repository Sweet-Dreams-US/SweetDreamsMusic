import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 36,
        }}
      >
        <span
          style={{
            color: '#F4C430',
            fontSize: 100,
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

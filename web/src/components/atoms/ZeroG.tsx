import type { CSSProperties, ReactNode } from "react";

// Official 0G brandmark (slashed-0 + G), in currentColor and sized to the surrounding text so it
// reads as the word "0G" wherever it appears.
export function ZeroG({ style }: { style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 50 24"
      role="img"
      aria-label="0G"
      focusable="false"
      style={{ display: "inline-block", height: "0.7em", width: "auto", verticalAlign: "-0.06em", margin: "0 0.05em", ...style }}
    >
      <path
        d="M50.0009 12.6136C49.6855 18.9497 44.3897 23.9913 37.9033 23.9913C31.214 23.9913 25.791 18.6291 25.791 12.0146C25.791 5.40009 31.214 0.0380859 37.9033 0.0380859C44.1841 0.0380859 49.3483 4.76491 49.956 10.8171H44.4555C43.8858 7.75086 41.169 5.42761 37.9035 5.42761C34.2241 5.42761 31.2416 8.37672 31.2416 12.0146C31.2416 15.6527 34.2241 18.6018 37.9035 18.6018C40.7281 18.6018 43.1418 16.8636 44.111 14.4101H34.8753V12.6136H50.0009Z"
        fill="currentColor"
      />
      <path
        d="M3.98642 20.8584C8.74078 25.1181 16.0905 24.9803 20.6772 20.4453C25.4072 15.7681 25.4072 8.18505 20.6772 3.50781C15.9469 -1.16927 8.27782 -1.16927 3.54764 3.50781C-0.893505 7.8992 -1.16488 14.8521 2.73348 19.5567L6.62297 15.7108C4.83311 13.1445 5.09269 9.60205 7.40183 7.31886C10.0034 4.7464 14.2215 4.7464 16.8231 7.31886C19.4245 9.89129 19.4245 14.062 16.8231 16.6345C14.8257 18.6094 11.8757 19.0682 9.43583 18.0106L15.9665 11.5531L14.6819 10.2829L3.98642 20.8584Z"
        fill="currentColor"
      />
    </svg>
  );
}

// Render a string with every standalone "0G" replaced by the brandmark. URLs use lowercase "0g" so
// they stay untouched. Use in copy: {zeroG("attested in a TEE, stored on 0G")}.
export function zeroG(text: string): ReactNode {
  if (!text.includes("0G")) return text;
  const segs = text.split("0G");
  const out: ReactNode[] = [];
  segs.forEach((seg, i) => {
    if (i > 0) out.push(<ZeroG key={`zg-${i}`} />);
    if (seg) out.push(<span key={`t-${i}`}>{seg}</span>);
  });
  return out;
}

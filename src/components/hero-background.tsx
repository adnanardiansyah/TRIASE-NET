import Image from "next/image";

export function HeroBackground() {
  return <Image
    src="/images/campus.jpg"
    alt=""
    fill
    priority
    sizes="(max-aspect-ratio: 3/2) 150vh, 100vw"
    className="landing-hero-photo"
    aria-hidden="true"
  />;
}

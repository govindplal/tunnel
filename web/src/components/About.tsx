import type { ReactNode } from "react";
import { ClockIcon, CloudIcon, FileIcon, LaptopIcon, LockIcon, Mascot, PhoneIcon, TextIcon, TunnelIcon } from "@/components/art";

function Step({ n, icon, title, children }: { n: number; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="card relative flex flex-col items-center gap-2 p-5 pt-7 text-center">
      <span className="absolute -top-3.5 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border-2 border-line bg-butter font-display text-sm font-semibold text-[#3b2a4a]">
        {n}
      </span>
      <div className="h-14 w-14">{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-muted">{children}</p>
    </li>
  );
}

function Fact({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <div className="h-11 w-11 shrink-0">{icon}</div>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm leading-relaxed text-muted">{children}</p>
      </div>
    </li>
  );
}

/** The "what is Tunnel?" story, shown below the pairing code. */
export function About() {
  return (
    <section id="about" aria-labelledby="about-title" className="mx-auto w-full max-w-2xl scroll-mt-6 px-6 pb-16 pt-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <Mascot className="bob h-28 w-32" />
        <h2 id="about-title" className="text-3xl font-semibold">
          Hi, I&apos;m Tunnel!
        </h2>
        <p className="max-w-md leading-relaxed text-muted">
          I dig a tiny tunnel between your phone and a computer that won&apos;t let anything in: no cables, no installs, no
          accounts. You send, I carry it across, and it pops out on the other side.
        </p>
      </div>

      <h2 className="mb-6 mt-12 text-center text-xl font-semibold">How it works</h2>
      <ol className="grid gap-6 sm:grid-cols-3">
        <Step n={1} icon={<PhoneIcon className="h-full w-full" />} title="Scan">
          Point your phone at the code at the top of this page. That&apos;s the whole sign-up.
        </Step>
        <Step n={2} icon={<TunnelIcon className="h-full w-full" />} title="Send">
          Share your clipboard, type some words, or pick a file. I carry it through the tunnel.
        </Step>
        <Step n={3} icon={<LaptopIcon className="h-full w-full" />} title="Receive">
          Text lands on your clipboard, ready to paste. Files wait in a tidy list you can preview or download.
        </Step>
      </ol>

      <h2 className="mb-6 mt-12 text-center text-xl font-semibold">What you can send</h2>
      <ul className="grid gap-6 sm:grid-cols-2">
        <Fact icon={<TextIcon className="h-full w-full" />} title="Text">
          Anything you can copy, up to a few pages. It&apos;s copied to the computer&apos;s clipboard the moment you open the
          tab.
        </Fact>
        <Fact icon={<FileIcon className="h-full w-full" />} title="Files">
          Photos and PDFs open right in the page. Everything is kept only in this browser, and only until you delete it.
        </Fact>
      </ul>

      <h2 className="mb-6 mt-12 text-center text-xl font-semibold">Kept private, kept light</h2>
      <ul className="flex flex-col gap-6">
        <Fact icon={<LockIcon className="h-full w-full" />} title="Your text is sealed">
          Text is locked on your phone and only unlocked on your computer. The secret that does it lives in the QR code&apos;s
          link and never travels to any server.
        </Fact>
        <Fact icon={<CloudIcon className="h-full w-full" />} title="The cloud just passes it along">
          The relay doesn&apos;t log or keep what you send. Files pass straight through and aren&apos;t stored anywhere but
          your computer&apos;s browser.
        </Fact>
        <Fact icon={<ClockIcon className="h-full w-full" />} title="Laptop asleep? I will wait (a bit)">
          If the computer isn&apos;t open yet, sealed text is held for up to 30 minutes and handed over when Tunnel opens. Then
          it&apos;s deleted. Files need the computer to be online.
        </Fact>
      </ul>

      <p className="mt-12 text-center text-sm text-muted">
        A web page can only copy to the clipboard while its tab is in front, so if it&apos;s tucked away I&apos;ll nudge you
        and copy the newest text when you come back.
      </p>
    </section>
  );
}

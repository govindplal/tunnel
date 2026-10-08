import type { ReactNode } from "react";
import { Tunnel } from "@/components/art";

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="card flex flex-col items-center gap-2 p-5 text-center">
      <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-line font-display text-sm font-semibold">
        {n}
      </span>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-muted">{children}</p>
    </li>
  );
}

function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-muted">{children}</p>
    </li>
  );
}

/** The "what is Tunnel?" story, shown below the pairing code. */
export function About() {
  return (
    <section id="about" aria-labelledby="about-title" className="mx-auto w-full max-w-2xl scroll-mt-6 px-6 pb-16 pt-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <Tunnel className="h-28 w-36" />
        <h2 id="about-title" className="text-3xl font-semibold">
          What is Tunnel?
        </h2>
        <p className="max-w-md leading-relaxed text-muted">
          A tiny tunnel between your phone and a computer that won&apos;t let anything in: no cables, no installs, no
          accounts. You send, it carries the message across, and it pops out on the other side.
        </p>
      </div>

      <h2 className="mb-6 mt-12 text-center text-xl font-semibold">How it works</h2>
      <ol className="grid gap-4 sm:grid-cols-3">
        <Step n={1} title="Scan">
          Point your phone at the code at the top of this page. That&apos;s the whole sign-up.
        </Step>
        <Step n={2} title="Send">
          Share your clipboard, type some words, or pick a file. It travels through the tunnel.
        </Step>
        <Step n={3} title="Receive">
          Text lands on your clipboard, ready to paste. Files wait in a tidy list you can preview or download.
        </Step>
      </ol>

      <h2 className="mb-6 mt-12 text-center text-xl font-semibold">What you can send</h2>
      <ul className="grid gap-6 sm:grid-cols-2">
        <Fact title="Text">
          Anything you can copy, up to a few pages. It&apos;s copied to the computer&apos;s clipboard the moment you open the
          tab.
        </Fact>
        <Fact title="Files">
          Photos and PDFs open right in the page. Everything is kept only in this browser, and only until you delete it.
        </Fact>
      </ul>

      <h2 className="mb-6 mt-12 text-center text-xl font-semibold">Kept private, kept light</h2>
      <ul className="flex flex-col gap-6">
        <Fact title="Your text is sealed">
          Text is locked on your phone and only unlocked on your computer. The secret that does it lives in the QR code&apos;s
          link and never travels to any server.
        </Fact>
        <Fact title="The cloud just passes it along">
          The relay doesn&apos;t log or keep what you send. Files pass straight through and aren&apos;t stored anywhere but
          your computer&apos;s browser.
        </Fact>
        <Fact title="Laptop asleep? It waits (a bit)">
          If the computer isn&apos;t open yet, sealed text is held for up to 30 minutes and handed over when Tunnel opens. Then
          it&apos;s deleted. Files need the computer to be online.
        </Fact>
      </ul>

      <p className="mt-12 text-center text-sm text-muted">
        A web page can only copy to the clipboard while its tab is in front, so if it&apos;s tucked away you&apos;ll get a
        nudge, and the newest text is copied when you come back.
      </p>
    </section>
  );
}

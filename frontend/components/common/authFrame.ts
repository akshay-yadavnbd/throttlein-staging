/**
 * The split card every signed-out page uses: sign in, sign up, forgot and
 * reset password, seller sign in and seller register. One place for the
 * frame so the pages can't drift to different widths and splits again.
 *
 *   <div className={authCardClass}>
 *     <aside className={authPanelClass}>…<h1 className={authHeadlineClass}>…</h1></aside>
 *     <section className={authFormClass}>…form…</section>
 *   </div>
 */

/** The card: art panel and form side by side from lg, stacked below it. */
export const authCardClass =
  'mx-auto grid w-full max-w-[1080px] overflow-hidden rounded-2xl border border-[#dfe3d8] bg-white shadow-[0_24px_60px_-30px_rgba(20,20,20,0.35)] lg:grid-cols-2';

/** The black panel. Same height on every page, so moving between them doesn't jump. */
export const authPanelClass =
  'relative flex flex-col justify-between overflow-hidden bg-brand-black p-7 text-white sm:p-9 lg:min-h-[600px] lg:p-12';

/** The panel's big headline. */
export const authHeadlineClass = 'text-[28px] font-bold leading-[1.08] tracking-tight sm:text-4xl lg:text-[42px]';

/** The form side. */
export const authFormClass = 'flex flex-col justify-center p-6 sm:p-10 lg:p-12';

import {
  ArrowRight,
  Building2,
  CheckCircle2,
  FileSearch,
  Globe2,
  KeyRound,
  ListChecks,
  Lock,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Link } from '@/lib/nav';
import { useAuth } from '@/components/AuthProvider';
import { BrandMark, ErrorAlert, Loading } from '@/components/ui';

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: ShieldCheck,
    title: 'Built on WCAG 2.2 AA',
    text: 'Audits test against WCAG 2.2 AA success criteria such as contrast, keyboard access, labels and focus. Results support your accessibility work; they are not a certification or legal advice.',
  },
  {
    icon: Globe2,
    title: 'Domain ownership checks',
    text: 'Add a website, then prove you own it with a DNS TXT record, or with a file served from a well-known address. Only verified domains can be audited.',
  },
  {
    icon: Building2,
    title: 'Projects per website',
    text: 'Keep every site you look after in its own project, so results never get mixed up between clients or products.',
  },
  {
    icon: Users,
    title: 'Roles for your team',
    text: 'Invite colleagues as owner, admin, member or viewer, so people only see and change what they should.',
  },
  {
    icon: FileSearch,
    title: 'Findings you can act on',
    text: 'Every issue is designed to say what is wrong, where it is and how to fix it, written for developers and designers alike.',
  },
  {
    icon: ListChecks,
    title: 'Progress over time',
    text: 'Track how a site improves from audit to audit, and show stakeholders the trend instead of a one-off report.',
  },
];

const STEPS = [
  {
    title: 'Create your account',
    text: 'Sign up with your email in under a minute. No card required.',
  },
  {
    title: 'Set up a workspace',
    text: 'An organization is your company or team. It holds your websites and the people who can see them.',
  },
  {
    title: 'Add and verify a website',
    text: 'Create a project, then confirm you own the domain with a DNS TXT record (recommended) or a well-known file on your site.',
  },
  {
    title: 'Audit and fix',
    text: 'Run an audit, review each finding with its evidence, check manual items and track fixes as a team.',
  },
];

const SECURITY: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Lock,
    title: 'Your data stays separate',
    text: 'Each organization is isolated at the database level, so one customer can never see another’s projects.',
  },
  {
    icon: KeyRound,
    title: 'Strong sign-in protection',
    text: 'Passwords are hashed with Argon2id, sessions use secure cookies, and every change is protected against cross-site request forgery.',
  },
  {
    icon: Globe2,
    title: 'No scanning of sites you do not own',
    text: 'Audits only run against domains you have verified, and the crawler is built to refuse internal and private network addresses.',
  },
];

const FAQ = [
  {
    q: 'What is website accessibility?',
    a: 'It means people with disabilities, such as those using screen readers, keyboards only, or magnification, can use your site. WCAG is the international standard that defines how.',
  },
  {
    q: 'What is WCAG 2.2 AA?',
    a: 'WCAG 2.2 is the current version of the Web Content Accessibility Guidelines. Level AA is the target many laws and procurement rules refer to.',
  },
  {
    q: 'Why do I have to verify my domain?',
    a: 'It proves you control the site. That stops anyone from running audits against a website that is not theirs.',
  },
  {
    q: 'Can my whole team use it?',
    a: 'Yes. Invite teammates to your organization and give each person the role that fits: owner, admin, member or viewer.',
  },
  {
    q: 'Does a clean scan mean my site is compliant?',
    a: 'No. AccessAudit does not certify WCAG conformance or legal compliance. Automated audits catch only part of the issues, so a clean result is not proof. Pair them with manual testing by people and, where needed, qualified advice.',
  },
];

const AUDIENCES: { title: string; points: string[] }[] = [
  {
    title: 'For engineering teams',
    points: [
      'Every finding shows the page, the element, a screenshot and the markup.',
      'Assign findings, change their status and discuss them in one place.',
      'Rescan after a fix and compare: new, regressed and resolved issues.',
    ],
  },
  {
    title: 'For accessibility consultants',
    points: [
      'Confirmed and potential findings are kept apart, with a confidence level.',
      'Manual verification checklists for what automation cannot decide.',
      'Exportable PDF, HTML, CSV and JSON reports with clear coverage limits.',
    ],
  },
];

function PreviewCard() {
  return (
    <div className="preview" aria-hidden="true">
      <div className="preview-bar">
        <span />
        <span />
        <span />
        <em>Example audit (illustrative)</em>
      </div>
      <div className="preview-body">
        <div className="preview-score">
          <div className="ring">
            <strong>3</strong>
            <small>confirmed</small>
          </div>
          <div>
            <p className="preview-site">shop.example.com</p>
            <p className="preview-sub">WCAG 2.2 AA · 24 pages · 5 potential · 8 to check by hand</p>
          </div>
        </div>
        <ul className="preview-list">
          <li>
            <span className="sev high">Serious</span>
            <span>Form fields are missing labels</span>
            <b>6</b>
          </li>
          <li>
            <span className="sev mid">Moderate</span>
            <span>Text contrast below 4.5:1</span>
            <b>11</b>
          </li>
          <li>
            <span className="sev mid">Moderate</span>
            <span>Images without alternative text</span>
            <b>4</b>
          </li>
          <li>
            <span className="sev low">Minor</span>
            <span>Link text is not descriptive</span>
            <b>3</b>
          </li>
        </ul>
      </div>
    </div>
  );
}

export default function Home() {
  const { status, error, refresh } = useAuth();
  const signedIn = status === 'authenticated';

  return (
    <div className="landing">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="site-header dark">
        <div className="site-header-inner">
          <Link href="/" className="brand">
            <BrandMark />
            AccessAudit
          </Link>
          <nav aria-label="Page sections" className="site-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#security">Security</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="site-actions">
            {signedIn ? (
              <Link href="/orgs" className="btn on-dark-solid">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="btn ghost on-dark">
                  Sign in
                </Link>
                <Link href="/register" className="btn on-dark-solid">
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main">
        <section className="hero-dark" aria-labelledby="hero-heading">
          <div className="section-inner hero-grid">
            <div>
              {status === 'loading' ? <Loading /> : null}
              {status === 'error' ? (
                <ErrorAlert error={error} onRetry={() => void refresh()} />
              ) : null}
              <span className="eyebrow dark">
                <ShieldCheck size={16} aria-hidden="true" />
                WCAG 2.2 AA accessibility auditing
              </span>
              <h1 id="hero-heading">
                Accessibility work you can <em>track</em>, for every site you run
              </h1>
              <p className="lead">
                AccessAudit helps product and engineering teams find accessibility barriers, fix
                them faster, and show clear progress to customers, auditors and leadership.
              </p>
              <div className="cta-row left">
                {signedIn ? (
                  <Link href="/orgs" className="btn large on-dark-solid">
                    Open dashboard
                    <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                ) : (
                  <>
                    <Link href="/register" className="btn large on-dark-solid">
                      Start for free
                      <ArrowRight size={18} aria-hidden="true" />
                    </Link>
                    <Link href="/quick-check" className="btn large on-dark-outline">
                      Check one page, no account
                    </Link>
                  </>
                )}
              </div>
              <ul className="hero-points">
                <li>
                  <CheckCircle2 size={16} aria-hidden="true" /> No credit card
                </li>
                <li>
                  <CheckCircle2 size={16} aria-hidden="true" /> Verified domains only
                </li>
                <li>
                  <CheckCircle2 size={16} aria-hidden="true" /> Private team workspaces
                </li>
              </ul>
            </div>
            <PreviewCard />
          </div>
        </section>

        <section className="why" aria-labelledby="why-heading">
          <div className="section-inner">
            <h2 id="why-heading">Why accessibility is now a business requirement</h2>
            <div className="why-grid">
              <div>
                <strong>Legal exposure</strong>
                <p>
                  Accessibility rules such as the European Accessibility Act and the ADA are
                  increasingly enforced, and procurement teams ask for evidence of the work you have
                  done.
                </p>
              </div>
              <div>
                <strong>Wider audience</strong>
                <p>
                  Hundreds of millions of people live with a disability. Barriers on your site mean
                  lost customers.
                </p>
              </div>
              <div>
                <strong>Better for everyone</strong>
                <p>
                  Clear labels, good contrast and keyboard support improve usability, SEO and
                  quality for all users.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section" id="audiences" aria-labelledby="aud-heading">
          <div className="section-inner">
            <h2 id="aud-heading">Built for the people who fix and the people who review</h2>
            <ul className="feature-grid">
              {AUDIENCES.map((a) => (
                <li key={a.title} className="card">
                  <h3>{a.title}</h3>
                  <ul>
                    {a.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <p className="sub">
              The example audit at the top uses illustrative demo data, not results from a real
              website.
            </p>
          </div>
        </section>

        <section className="landing-section alt" id="features" aria-labelledby="features-heading">
          <div className="section-inner">
            <h2 id="features-heading">Everything you need to manage accessibility</h2>
            <p className="sub">One workspace for your sites, your team and your results.</p>
            <ul className="feature-grid">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="card">
                  <span className="feature-icon" aria-hidden="true">
                    <Icon size={22} />
                  </span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-section alt" id="how" aria-labelledby="how-heading">
          <div className="section-inner">
            <h2 id="how-heading">From sign-up to your first audit in four steps</h2>
            <p className="sub">Nothing to install. Everything runs in your browser.</p>
            <ol className="how">
              {STEPS.map((s) => (
                <li key={s.title}>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="landing-section" id="security" aria-labelledby="security-heading">
          <div className="section-inner">
            <h2 id="security-heading">Security and privacy built in from day one</h2>
            <p className="sub">
              You are trusting us with information about your websites. We treat that seriously.
            </p>
            <ul className="feature-grid">
              {SECURITY.map(({ icon: Icon, title, text }) => (
                <li key={title} className="card">
                  <span className="feature-icon" aria-hidden="true">
                    <Icon size={22} />
                  </span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-section alt" id="faq" aria-labelledby="faq-heading">
          <div className="section-inner narrow">
            <h2 id="faq-heading">Frequently asked questions</h2>
            <div className="faq">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {signedIn ? null : (
          <div className="section-inner">
            <section className="cta-band" aria-labelledby="cta-heading">
              <h2 id="cta-heading">Start making your website work for everyone</h2>
              <p>Create your free account and add your first website in minutes.</p>
              <Link href="/register" className="btn large">
                Get started free
              </Link>
            </section>
          </div>
        )}
      </main>

      <footer className="site-footer-dark">
        <div className="section-inner footer-grid">
          <div>
            <Link href="/" className="brand">
              <BrandMark />
              AccessAudit
            </Link>
            <p>
              Website accessibility auditing for teams that care about everyone who uses their
              product.
            </p>
          </div>
          <nav aria-label="Footer">
            <h2>Product</h2>
            <ul>
              <li>
                <a href="#features">Features</a>
              </li>
              <li>
                <a href="#how">How it works</a>
              </li>
              <li>
                <a href="#security">Security</a>
              </li>
              <li>
                <a href="#faq">FAQ</a>
              </li>
            </ul>
          </nav>
          <div>
            <h2>Account</h2>
            <ul>
              <li>
                <Link href="/login">Sign in</Link>
              </li>
              <li>
                <Link href="/register">Create account</Link>
              </li>
              <li>
                <Link href="/quick-check">Quick check</Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="section-inner footer-base">
          © {new Date().getFullYear()} AccessAudit. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

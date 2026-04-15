import gavelIcon from "../../assets/JuriNex_gavel_logo.png"

const Footer = ({ onOpenPolicy, onGetInTouch }) => {
  const year = new Date().getFullYear()

  return (
    <footer id="about" className="bg-white">
      {/* "Get in touch" banner */}
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 rounded-2xl bg-gray-100 px-8 py-6 sm:flex-row">
          <p className="font-dmSans text-lg font-medium text-teal-700">
            Have a question or a use case in mind?
          </p>
          <button
            type="button"
            onClick={onGetInTouch}
            className="rounded-lg bg-teal-600 px-6 py-2.5 font-dmSans text-sm font-semibold text-white transition-all hover:bg-teal-600/90 active:scale-[0.98]"
          >
            Get in touch
          </button>
        </div>
      </div>

      {/* Main footer */}
      <div className="mx-auto max-w-7xl px-4 pb-8 pt-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
          {/* Brand */}
          <div className="max-w-xs">
            <a href="#platform" className="inline-flex items-center gap-2">
              <img src={gavelIcon} alt="" aria-hidden="true" className="h-8 w-8 rounded-lg" />
              <span className="font-playfair text-lg font-bold text-teal-700">
                JuriNex by NextIntel AI
              </span>
            </a>
            <p className="mt-3 font-dmSans text-sm leading-relaxed text-juri-muted">
              Transforming legal document analysis with cutting-edge AI technology.
            </p>
          </div>

          {/* Right columns */}
          <div className="flex gap-16">
            {/* Contact Us */}
            <div>
              <p className="font-dmSans text-sm font-semibold text-teal-700">Contact Us</p>
              <address className="mt-3 space-y-1 font-dmSans text-sm not-italic text-juri-muted">
                <p>B-11, Near Railway Station Road,</p>
                <p>MIDC, Chhatrapati Sambhaji Nagar,</p>
                <p>Maharashtra 431005</p>
                <p className="mt-2">+91 9684027372</p>
                <a
                  href="mailto:info@nexintelai.com"
                  className="block text-teal-600 hover:underline"
                >
                  info@nexintelai.com
                </a>
              </address>
            </div>

            {/* Legal */}
            <div>
              <p className="font-dmSans text-sm font-semibold text-teal-700">Legal</p>
              <ul className="mt-3 space-y-2">
                <li>
                  <button
                    type="button"
                    onClick={() => onOpenPolicy?.("terms")}
                    className="font-dmSans text-sm text-juri-muted transition hover:text-teal-600"
                  >
                    Terms &amp; Conditions
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => onOpenPolicy?.("dpdpa")}
                    className="font-dmSans text-sm text-juri-muted transition hover:text-teal-600"
                  >
                    Privacy Policy
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 border-t border-teal-300/60 pt-6 text-center">
          <p className="font-dmSans text-sm text-juri-muted">
            © {year} NexIntelAI. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}

export default Footer


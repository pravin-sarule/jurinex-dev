import PropTypes from "prop-types"
import gavelIcon from "../../assets/JuriNex_gavel_logo.png"

/**
 * JURINEX™ brand lockup — teal gavel tile + bold letterspaced wordmark
 * with the circled TM, matching the official logo artwork.
 */
const BrandLogo = ({ size = "md", light = false }) => {
  const iconClass = size === "lg" ? "h-10 w-10" : "h-9 w-9"
  const textClass = size === "lg" ? "text-[1.35rem]" : "text-xl"

  return (
    <span className="flex items-center gap-2.5">
      <img
        src={gavelIcon}
        alt=""
        aria-hidden="true"
        className={`${iconClass} flex-none rounded-lg`}
      />
      <span
        className={`flex items-start gap-1 font-body ${textClass} font-extrabold uppercase leading-none tracking-[0.18em] ${
          light ? "text-white" : "text-nx-ink"
        }`}
      >
        Jurinex
        <span
          aria-hidden="true"
          className={`mt-[-1px] grid h-3.5 w-3.5 flex-none place-items-center rounded-full border text-[6px] font-bold tracking-normal ${
            light ? "border-white/70" : "border-nx-ink/70"
          }`}
        >
          TM
        </span>
      </span>
    </span>
  )
}

BrandLogo.propTypes = {
  size: PropTypes.oneOf(["md", "lg"]),
  light: PropTypes.bool,
}

export default BrandLogo

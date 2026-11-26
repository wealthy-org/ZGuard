// Builds ../sp1-quote-guest with the Succinct toolchain so `include_elf!` can embed it.
fn main() {
    sp1_build::build_program_with_args("../sp1-quote-guest", Default::default())
}

import Tooltip from "./Tooltip";

export default function About() {
  return (
    <section className="w-full relative h-screen pt-48 flex flex-col justify-center items-center text-center">
      <div className="w-full xl:max-w-[85vw] px-8 flex flex-col gap-4">
        <h2 className="text-[30vw] leading-[0.5] font-primary font-bold">
          WHO WE ARE
        </h2>
        <p className="text-lg md:text-xl lg:text-2xl font-secondary font-normal text-secondary text-balance">
          <Tooltip content="MIT CSC was founded in 1916 and has been serving the MIT community for over a century!">
            Chinese Student's Club
          </Tooltip>{" "}
          is the oldest cultural club at MIT. Throughout the years we've
          continued to be a hub for people who like Chinese-American culture,
          good food, and good company. We're here to help the people of MIT and
          Boston create memories and friends at our{" "}
          <Tooltip content="Study breaks, formals, Chinatown food runs, and so much more">
            events
          </Tooltip>{" "}
          (inspired by Chinese-American culture). Whether you need a study
          break,{" "}
          <Tooltip content="And many other snacks and beverages">
            free boba
          </Tooltip>
          , or a boat to party on, CSC is here for you!
        </p>
      </div>
    </section>
  );
}

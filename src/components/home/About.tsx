"use client";

import Tooltip from "@/components/Tooltip";
import Header from "@/components/Header";

export default function About() {
  return (
    <section
      id="about"
      className="w-full relative h-screen flex flex-col justify-center items-center text-center"
    >
      <div className="w-full xl:max-w-7xl px-8 flex flex-col gap-4">
        <Header title="what is CSC" />
        <p className="text-lg md:text-xl lg:text-2xl font-secondary font-normal text-secondary text-balance">
          <Tooltip content="CSC was founded in 1916 and has been serving the MIT community for over a century!">
            Chinese Students Club
          </Tooltip>{" "}
          is the oldest cultural club at MIT. Throughout the years we&apos;ve
          continued to be a hub for people who like Chinese-American culture,
          good food, and good company. We&apos;re here to help the people of MIT and
          Boston create memories and friends at our{" "}
          <Tooltip content="Study breaks, formals, Chinatown food runs, and so much more">
            events
          </Tooltip>{" "}
          (inspired by Chinese-American culture). Whether you need a study
          break,{" "}
          <Tooltip content="Plus so many other yummy snacks and beverages :)">
            free boba
          </Tooltip>
          , or a boat to party on, CSC is here for you!
        </p>
      </div>
    </section>
  );
}

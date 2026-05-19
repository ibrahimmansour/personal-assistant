"use client";

import { useEffect, useState, useRef } from "react";
import { WidgetWrapper } from "@/components/widget-wrapper";
import { Clock, MapPin } from "lucide-react";

function AnalogClock({ time }: { time: Date }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 4;

    ctx.clearRect(0, 0, size, size);

    // Resolve CSS variable colours to hex so canvas can use them
    const style = getComputedStyle(document.documentElement);
    const primaryRaw = style.getPropertyValue("--primary").trim();
    // CSS vars are oklch — convert to a usable colour via a temp element
    const tmpEl = document.createElement("div");
    tmpEl.style.color = `oklch(${primaryRaw})`;
    document.body.appendChild(tmpEl);
    const primaryColor = getComputedStyle(tmpEl).color; // rgb(...)
    document.body.removeChild(tmpEl);

    const fgRaw = style.getPropertyValue("--foreground").trim();
    const tmpEl2 = document.createElement("div");
    tmpEl2.style.color = `oklch(${fgRaw})`;
    document.body.appendChild(tmpEl2);
    const fgColor = getComputedStyle(tmpEl2).color;
    document.body.removeChild(tmpEl2);

    const mutedRaw = style.getPropertyValue("--muted-foreground").trim();
    const tmpEl3 = document.createElement("div");
    tmpEl3.style.color = `oklch(${mutedRaw})`;
    document.body.appendChild(tmpEl3);
    const mutedColor = getComputedStyle(tmpEl3).color;
    document.body.removeChild(tmpEl3);

    // Clock face
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = mutedColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Hour ticks
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const isQuarter = i % 3 === 0;
      const tickLen = isQuarter ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * (r - tickLen), cy + Math.sin(angle) * (r - tickLen));
      ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      ctx.strokeStyle = isQuarter ? fgColor : mutedColor;
      ctx.lineWidth = isQuarter ? 2 : 1;
      ctx.stroke();
    }

    const sec = time.getSeconds();
    const min = time.getMinutes();
    const hr = time.getHours() % 12;

    const secAngle = (sec / 60) * Math.PI * 2 - Math.PI / 2;
    const minAngle = ((min + sec / 60) / 60) * Math.PI * 2 - Math.PI / 2;
    const hrAngle = ((hr + min / 60) / 12) * Math.PI * 2 - Math.PI / 2;

    // Hour hand
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(hrAngle) * r * 0.52, cy + Math.sin(hrAngle) * r * 0.52);
    ctx.strokeStyle = fgColor;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();

    // Minute hand
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(minAngle) * r * 0.72, cy + Math.sin(minAngle) * r * 0.72);
    ctx.strokeStyle = fgColor;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();

    // Second hand
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(secAngle) * r * 0.82, cy + Math.sin(secAngle) * r * 0.82);
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = primaryColor;
    ctx.fill();
  }, [time]);

  return (
    <canvas
      ref={canvasRef}
      width={96}
      height={96}
      className="shrink-0"
    />
  );
}

export function ClockWidget() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = time.getHours();
  const greeting =
    hours < 5 ? "Good night" :
    hours < 12 ? "Good morning" :
    hours < 17 ? "Good afternoon" :
    hours < 21 ? "Good evening" : "Good night";

  const greetingColor =
    hours < 5 ? "text-violet-400" :
    hours < 12 ? "text-amber-500" :
    hours < 17 ? "text-sky-500" :
    hours < 21 ? "text-orange-400" : "text-violet-400";

  return (
    <WidgetWrapper
      title="Clock"
      icon={<Clock className="h-4 w-4" />}
    >
      <div className="flex items-center justify-center h-full gap-5">
        <AnalogClock time={time} />
        <div className="flex flex-col gap-0.5">
          <p className={`text-xs font-semibold tracking-wide uppercase ${greetingColor}`}>
            {greeting}
          </p>
          <p className="text-4xl font-bold tracking-tight tabular-nums text-foreground">
            {time.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <p className="text-sm font-medium text-foreground/70 tabular-nums">
            {time.toLocaleTimeString("en-US", {
              second: "2-digit",
            }).replace(/.*:/, ":")}
          </p>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
            <MapPin className="h-3 w-3" />
            {time.toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>
      </div>
    </WidgetWrapper>
  );
}

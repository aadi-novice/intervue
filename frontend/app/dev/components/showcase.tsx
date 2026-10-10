"use client";

import { useRef, useState } from "react";
import {
  AssistChip,
  AudioPlayer,
  Badge,
  BotStatusChip,
  BottomSheetContent,
  Button,
  Card,
  CandidateAvatar,
  Checkbox,
  CircularProgress,
  ClaimCheckBadge,
  CriterionBar,
  DateTimePicker,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  Divider,
  ExtendedFab,
  Fab,
  FilterChip,
  Icon,
  IconButton,
  InputChip,
  KanbanColumn,
  LinearProgress,
  List,
  ListItem,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  NavigationBar,
  NavigationRail,
  PlainTooltip,
  Radio,
  RadioGroup,
  RichTooltip,
  ScoreRing,
  SearchBar,
  Select,
  SegmentedButton,
  Sheet,
  SheetTrigger,
  SideSheetContent,
  Skeleton,
  Slider,
  SplitButton,
  SuggestionChip,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextField,
  TopAppBar,
  SummaryCard,
  TranscriptViewer,
  useSnackbar,
  type AudioPlayerHandle,
  type BotStatus,
  type TranscriptSegment,
} from "@/components/m3";

const BOT_STATUSES: BotStatus[] = ["scheduled", "launching", "joining", "waiting_admission", "in_call", "leaving", "processing", "completed", "failed"];

const SEGMENTS: TranscriptSegment[] = Array.from({ length: 200 }, (_, i) => ({
  id: `s${i}`,
  speaker_label: i % 2 === 0 ? "Interviewer" : i % 7 === 0 ? "Speaker 3" : "Candidate",
  speaker_kind: i % 2 === 0 ? "interviewer" : i % 7 === 0 ? "unknown" : "candidate",
  start_ms: i * 12000,
  end_ms: i * 12000 + 11000,
  text:
    i % 2 === 0
      ? `Question ${i / 2 + 1}: can you walk me through a system you designed end to end?`
      : "I designed a streaming pipeline with Kafka and Rust workers, and we reduced latency by forty percent.",
}));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 title-l">{title}</h2>
      <Divider className="mb-4" />
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div>
      {label && <p className="mb-2 label-m text-on-surface-variant">{label}</p>}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export function Showcase() {
  const snackbar = useSnackbar();
  const audio = useRef<AudioPlayerHandle>(null);
  const [seg, setSeg] = useState("list");
  const [multi, setMulti] = useState<string[]>(["a"]);
  const [toggle, setToggle] = useState(true);
  const [sw, setSw] = useState(true);
  const [radio, setRadio] = useState("one");
  const [slider, setSlider] = useState([40]);
  const [search, setSearch] = useState("");
  const [when, setWhen] = useState<Date | null>(null);
  const [filter, setFilter] = useState(true);
  const [text, setText] = useState("");
  const [tab, setTab] = useState("one");
  const [seek, setSeek] = useState<number | null>(null);

  const states = ["filled", "tonal", "outlined", "text", "elevated"] as const;

  return (
    <div>
      <Section title="Actions">
        {states.map((v) => (
          <Row key={v} label={`Button / ${v}`}>
            <Button variant={v}>Label</Button>
            <Button variant={v} icon="add">With icon</Button>
            <Button variant={v} disabled>Disabled</Button>
            <Button variant={v} loading>Loading</Button>
          </Row>
        ))}
        <Row label="Icon button (standard / filled / tonal / outlined, toggle)">
          {(["standard", "filled", "tonal", "outlined"] as const).map((v) => (
            <IconButton key={v} variant={v} icon="favorite" label={`${v} icon button`} />
          ))}
          <IconButton variant="tonal" icon="bookmark" label="Toggle bookmark" selected={toggle} onSelectedChange={setToggle} />
          <IconButton icon="delete" label="Disabled" disabled />
        </Row>
        <Row label="FAB / Extended FAB">
          <Fab icon="add" label="Add small" size="small" />
          <Fab icon="add" label="Add" />
          <Fab icon="add" label="Add large" size="large" />
          <ExtendedFab icon="edit">Compose</ExtendedFab>
          <ExtendedFab icon="edit" collapsed color="secondary">Compose</ExtendedFab>
        </Row>
        <Row label="Segmented button (single / multi)">
          <SegmentedButton
            aria-label="View"
            value={seg}
            onValueChange={setSeg}
            options={[{ value: "list", label: "List" }, { value: "grid", label: "Grid" }, { value: "table", label: "Table", disabled: true }]}
          />
          <SegmentedButton
            multiple
            aria-label="Flags"
            value={multi}
            onValueChange={setMulti}
            options={[{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }]}
          />
        </Row>
        <Row label="Split button">
          <SplitButton label="Schedule" icon="event" onClick={() => snackbar.show("Scheduled")} actions={[{ label: "Schedule later", icon: "schedule", onSelect: () => {} }, { label: "Paste link", icon: "link", onSelect: () => {} }]} />
        </Row>
      </Section>

      <Section title="Communication">
        <Row label="Badge">
          <span className="relative inline-flex"><Icon name="notifications" /><Badge overlay /></span>
          <span className="relative inline-flex"><Icon name="mail" /><Badge count={3} overlay /></span>
          <span className="relative inline-flex"><Icon name="mail" /><Badge count={1200} overlay /></span>
        </Row>
        <Row label="Progress">
          <div className="w-60"><LinearProgress value={60} /></div>
          <div className="w-60"><LinearProgress /></div>
          <CircularProgress value={70} />
          <CircularProgress />
        </Row>
        <Row label="Snackbar / Tooltip">
          <Button variant="tonal" onClick={() => snackbar.show("Saved")}>Snackbar</Button>
          <Button variant="tonal" onClick={() => snackbar.show({ message: "Candidate archived", action: { label: "Undo", onClick: () => {} }, showClose: true })}>With action</Button>
          <PlainTooltip content="Plain tooltip"><Button variant="outlined">Hover me</Button></PlainTooltip>
          <RichTooltip title="Rich tooltip" content="Supporting text with detail." action={{ label: "Learn more", onClick: () => {} }}><Button variant="outlined">Rich</Button></RichTooltip>
        </Row>
      </Section>

      <Section title="Containment">
        <div className="grid gap-3 medium:grid-cols-3">
          {(["elevated", "filled", "outlined"] as const).map((v) => (
            <Card key={v} variant={v} className="p-4"><p className="title-s">{v}</p><p className="body-s text-on-surface-variant">Static card</p></Card>
          ))}
          <Card variant="elevated" onPress={() => snackbar.show("Card pressed")} className="p-4"><p className="title-s">Interactive</p><p className="body-s text-on-surface-variant">State layer + ripple</p></Card>
        </div>
        <Row label="Dialog / Bottom sheet / Side sheet">
          <Dialog>
            <DialogTrigger asChild><Button variant="outlined">Dialog</Button></DialogTrigger>
            <DialogContent title="Delete candidate?" description="This removes all their data." icon="delete" fullScreenOnMobile actions={<><DialogClose asChild><Button variant="text">Cancel</Button></DialogClose><DialogClose asChild><Button variant="text">Delete</Button></DialogClose></>} />
          </Dialog>
          <Sheet>
            <SheetTrigger asChild><Button variant="outlined">Bottom sheet</Button></SheetTrigger>
            <BottomSheetContent title="Share" showClose><p className="body-m">Sheet content</p></BottomSheetContent>
          </Sheet>
          <Sheet>
            <SheetTrigger asChild><Button variant="outlined">Side sheet</Button></SheetTrigger>
            <SideSheetContent title="Filters"><p className="body-m">Side sheet content</p></SideSheetContent>
          </Sheet>
        </Row>
        <Row label="List / Divider">
          <List className="w-full max-w-md rounded-md bg-surface-container-low">
            <ListItem leading={<Icon name="person" />} headline="One-line item" />
            <Divider inset />
            <ListItem leading={<Icon name="mail" />} headline="Two-line item" supporting="Supporting text" trailing="12:30" onPress={() => {}} />
            <ListItem leading={<Icon name="star" filled />} headline="Selected" supporting="Selected state" selected onPress={() => {}} />
          </List>
        </Row>
        <Row label="Menu">
          <Menu>
            <MenuTrigger asChild><Button variant="tonal" trailingIcon="arrow_drop_down">Menu</Button></MenuTrigger>
            <MenuContent><MenuItem leadingIcon="edit">Edit</MenuItem><MenuItem leadingIcon="delete" trailingText="Del">Delete</MenuItem><MenuSeparator /><MenuItem disabled>Disabled</MenuItem></MenuContent>
          </Menu>
        </Row>
      </Section>

      <Section title="Navigation">
        <Row label="Navigation rail">
          <div className="h-80 rounded-md border border-outline-variant">
            <NavigationRail
              activeId="b"
              destinations={[{ id: "a", label: "Home", icon: "dashboard", href: "#" }, { id: "b", label: "Roles", icon: "work", href: "#", badge: 2 }, { id: "c", label: "People", icon: "groups", href: "#" }]}
              renderLink={(p) => <a href={p.href} className={p.className} aria-current={p["aria-current"]}>{p.children}</a>}
              header={<Fab icon="add" label="New" color="tertiary" />}
            />
          </div>
        </Row>
        <Row label="Navigation bar">
          <div className="w-full max-w-md overflow-hidden rounded-md border border-outline-variant">
            <NavigationBar
              activeId="a"
              destinations={[{ id: "a", label: "Home", icon: "dashboard", href: "#" }, { id: "b", label: "Roles", icon: "work", href: "#" }, { id: "c", label: "People", icon: "groups", href: "#" }]}
              renderLink={(p) => <a href={p.href} className={p.className} aria-current={p["aria-current"]}>{p.children}</a>}
            />
          </div>
        </Row>
        <Row label="Top app bar (small / medium / large; modal drawer is in the app shell)">
          {(["small", "medium", "large"] as const).map((v) => (
            <div key={v} className="w-full max-w-md overflow-hidden rounded-md border border-outline-variant">
              <TopAppBar variant={v} title={`${v} bar`} leading={<IconButton icon="menu" label="Menu" />} trailing={<IconButton icon="more_vert" label="More" />} className="!static" />
            </div>
          ))}
        </Row>
        <Row label="Tabs (primary / secondary)">
          <div className="w-full max-w-md space-y-4">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList><TabsTrigger value="one" icon="work">Roles</TabsTrigger><TabsTrigger value="two" icon="groups">People</TabsTrigger></TabsList>
              <TabsContent value="one" className="p-3 body-m">First panel</TabsContent>
              <TabsContent value="two" className="p-3 body-m">Second panel</TabsContent>
            </Tabs>
            <Tabs defaultValue="a">
              <TabsList variant="secondary"><TabsTrigger value="a">Overview</TabsTrigger><TabsTrigger value="b">Activity</TabsTrigger></TabsList>
              <TabsContent value="a" className="p-3 body-m">Overview</TabsContent>
              <TabsContent value="b" className="p-3 body-m">Activity</TabsContent>
            </Tabs>
          </div>
        </Row>
      </Section>

      <Section title="Selection & input">
        <Row label="Chips">
          <AssistChip label="Add to calendar" icon="event" />
          <FilterChip label="Senior" selected={filter} onSelectedChange={setFilter} />
          <FilterChip label="Remote" selected={false} />
          <InputChip label="Rust" onRemove={() => {}} />
          <SuggestionChip label="gRPC" icon="add" />
          <AssistChip label="Disabled" disabled />
        </Row>
        <Row label="Checkbox / Radio / Switch">
          <Checkbox label="Checked" defaultChecked />
          <Checkbox label="Unchecked" />
          <Checkbox label="Indeterminate" checked="indeterminate" />
          <Checkbox label="Error" error />
          <Checkbox label="Disabled" disabled />
          <RadioGroup value={radio} onValueChange={setRadio} className="flex-row">
            <Radio value="one" label="One" />
            <Radio value="two" label="Two" />
            <Radio value="three" label="Off" disabled />
          </RadioGroup>
          <Switch label="Switch" checked={sw} onCheckedChange={setSw} className="ms-2" />
          <Switch label="Disabled" disabled />
        </Row>
        <Row label="Slider">
          <div className="w-72"><Slider aria-label="Volume" value={slider} onValueChange={setSlider} max={100} /></div>
        </Row>
        <Row label="Text field (filled / outlined / error / disabled / multiline)">
          <TextField label="Filled" value={text} onChange={(e) => setText(e.target.value)} containerClassName="w-60" supportingText="Supporting text" />
          <TextField variant="outlined" label="Outlined" containerClassName="w-60" leadingIcon="search" />
          <TextField variant="outlined" label="Error" defaultValue="bad@" error="Enter a valid email" containerClassName="w-60" />
          <TextField label="Disabled" disabled defaultValue="Nope" containerClassName="w-60" />
          <TextField variant="outlined" label="Notes" multiline containerClassName="w-60" />
        </Row>
        <Row label="Select">
          <Select className="w-60" label="Seniority" options={[{ value: "j", label: "Junior" }, { value: "s", label: "Senior" }, { value: "p", label: "Principal" }]} />
          <Select className="w-60" variant="filled" label="Filled select" defaultValue="s" options={[{ value: "j", label: "Junior" }, { value: "s", label: "Senior" }]} />
        </Row>
        <Row label="Search bar">
          <div className="w-full max-w-md"><SearchBar value={search} onValueChange={setSearch} placeholder="Search candidates" /></div>
        </Row>
        <Row label="Date / time picker">
          <DateTimePicker label="Interview time" value={when} onChange={setWhen} className="w-72" />
        </Row>
      </Section>

      <Section title="Domain">
        <Row label="ScoreRing (strong / medium / weak / none)">
          <ScoreRing value={92} /><ScoreRing value={68} /><ScoreRing value={35} /><ScoreRing value={0} />
        </Row>
        <Row label="CriterionBar">
          <div className="w-64 space-y-3"><CriterionBar label="System design" value={88} /><CriterionBar label="Communication" value={62} /><CriterionBar label="Testing" value={30} /></div>
        </Row>
        <Row label="ClaimCheckBadge">
          <ClaimCheckBadge status="verified" /><ClaimCheckBadge status="unclear" /><ClaimCheckBadge status="contradicted" />
        </Row>
        <Row label="BotStatusChip">
          {BOT_STATUSES.map((s) => <BotStatusChip key={s} status={s} />)}
        </Row>
        <Row label="CandidateAvatar">
          <CandidateAvatar name="Priya Sharma" size="sm" /><CandidateAvatar name="Arjun Mehta" /><CandidateAvatar name="Lee Wei" size="lg" /><CandidateAvatar name="Sam Okafor" size="xl" shape="rounded" />
        </Row>
        <Row label="SummaryCard">
          <div className="w-full max-w-md">
            <SummaryCard
              name="Priya Sharma" subtitle="Senior Rust Engineer" fitScore={87}
              criteria={[{ label: "Systems", score: 90 }, { label: "Distributed", score: 78 }]}
              interviewScores={[{ label: "Technical", score: 84 }, { label: "Communication", score: 70 }]}
              claimFlags={[{ status: "verified", text: "Led migration to gRPC" }, { status: "contradicted", text: "Claimed 8 years Rust; transcript says 3" }]}
              notesExcerpt="Strong fundamentals; probe on on-call experience."
              aiSuggestion="yes" onPress={() => {}}
            />
          </div>
        </Row>
        <Row label="KanbanColumn (default / over / empty)">
          <KanbanColumn stage="screening" label="AI Screening" count={1}><div className="rounded-md bg-surface-container-high p-3 body-s">Card</div></KanbanColumn>
          <KanbanColumn stage="offer" label="Offer" count={0} isOver />
          <KanbanColumn stage="hired" label="Hired" count={0} />
        </Row>
        <Row label="Skeleton">
          <div className="w-64 space-y-2"><Skeleton className="h-6 w-40" /><Skeleton className="h-4 w-full" /><Skeleton className="h-24 w-full rounded-md" /></div>
        </Row>
        <Row label="AudioPlayer (controlled seek; no audio source in the gallery)">
          <div className="w-full max-w-xl"><AudioPlayer ref={audio} src="" seekToMs={seek} /></div>
          <Button variant="text" onClick={() => audio.current?.seek(30000)}>Seek 0:30 (ref)</Button>
          <Button variant="text" onClick={() => setSeek(60000 + Math.floor(Math.random() * 1000))}>Seek 1:00 (prop)</Button>
        </Row>
        <Row label="TranscriptViewer (200 virtualised segments)">
          <div className="w-full"><TranscriptViewer segments={SEGMENTS} height={320} onSeek={(ms) => audio.current?.seek(ms)} /></div>
        </Row>
      </Section>

      <Section title="Type scale, shape, elevation">
        <div className="space-y-1">
          {["display-l", "display-m", "display-s", "headline-l", "headline-m", "headline-s", "title-l", "title-m", "title-s", "body-l", "body-m", "body-s", "label-l", "label-m", "label-s"].map((c) => (
            <p key={c} className={c}>{c} — The quick brown fox</p>
          ))}
        </div>
        <Row label="Shape: none / xs / sm / md / lg / xl / full">
          {["rounded-none", "rounded-xs", "rounded-sm", "rounded-md", "rounded-lg", "rounded-xl", "rounded-full"].map((r) => (
            <div key={r} className={`size-16 bg-primary-container ${r}`} title={r} />
          ))}
        </Row>
        <Row label="Elevation 0-5">
          {["elevation-0", "elevation-1", "elevation-2", "elevation-3", "elevation-4", "elevation-5"].map((e) => (
            <div key={e} className={`flex size-16 items-center justify-center rounded-md bg-surface-container-low label-s ${e}`}>{e.slice(-1)}</div>
          ))}
        </Row>
        <Row label="Surface tones">
          {["bg-surface-container-lowest", "bg-surface-container-low", "bg-surface-container", "bg-surface-container-high", "bg-surface-container-highest", "bg-surface-dim", "bg-surface-bright"].map((s) => (
            <div key={s} className={`flex h-16 w-24 items-center justify-center rounded-md border border-outline-variant label-s ${s}`}>{s.replace("bg-surface-", "")}</div>
          ))}
        </Row>
      </Section>
    </div>
  );
}

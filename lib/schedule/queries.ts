/**
 * 排班查詢層
 *
 * 跟 lib/pricing/queries.ts 一樣用 service role client（見
 * lib/supabase/service-role.ts 的說明），原因也一致：目前系統還沒
 * 接 Supabase Auth 登入流程。
 */

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getSingleOrganizationId } from "@/lib/pricing/queries";
import { roomAllocationSummaryItems } from "@/lib/pricing/quote-message";

export interface Employee {
  id: string;
  name: string;
  shortName: string;
}

/** 房務排班用的員工職稱：只有這兩種才會出現在排班表單的選單裡 */
const HOUSEKEEPING_POSITIONS = ["管家", "房務員"];

/** 員工列表，給排班表單的下拉選單用，只顯示在職、職稱是管家或房務員的員工 */
export async function listActiveEmployees(): Promise<Employee[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("employees")
    .select("id, name, short_name")
    .eq("employment_status", "active")
    .in("position", HOUSEKEEPING_POSITIONS)
    .order("name");
  if (error) {
    throw new Error(`查詢員工列表失敗：${error.message}`);
  }
  return ((data ?? []) as any[]).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    shortName: (row.short_name as string) || (row.name as string),
  }));
}

/** 員工完整資料，給員工管理頁面（建立/編輯）用 */
export interface EmployeeDetail {
  id: string;
  name: string;
  shortName: string | null;
  phone: string | null;
  email: string | null;
  position: string | null;
  employmentStatus: string;
  birthDate: string | null;
  hireDate: string | null;
  lineId: string | null;
  /** 有沒有連結登入帳號（employees.user_id 是否有值） */
  hasLoginAccount: boolean;
}

const EMPLOYEE_SELECT =
  "id, name, short_name, phone, email, position, employment_status, birth_date, hire_date, line_id, user_id";

function mapEmployeeRow(row: any): EmployeeDetail {
  return {
    id: row.id as string,
    name: row.name as string,
    shortName: (row.short_name as string) ?? null,
    phone: (row.phone as string) ?? null,
    email: (row.email as string) ?? null,
    position: (row.position as string) ?? null,
    employmentStatus: row.employment_status as string,
    birthDate: (row.birth_date as string) ?? null,
    hireDate: (row.hire_date as string) ?? null,
    lineId: (row.line_id as string) ?? null,
    hasLoginAccount: Boolean(row.user_id),
  };
}

/** 全部員工（含離職），依在職狀態、姓名排序，給員工管理頁面用 */
export async function listAllEmployees(): Promise<EmployeeDetail[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("employees")
    .select(EMPLOYEE_SELECT)
    .order("employment_status")
    .order("name");
  if (error) {
    throw new Error(`查詢員工列表失敗：${error.message}`);
  }
  return ((data ?? []) as any[]).map(mapEmployeeRow);
}

export interface EmployeeFields {
  name: string;
  shortName: string | null;
  phone: string | null;
  email: string | null;
  position: string | null;
  employmentStatus: string;
  birthDate: string | null;
  hireDate: string | null;
  lineId: string | null;
}

export async function createEmployee(fields: EmployeeFields): Promise<void> {
  const supabase = createServiceRoleClient();
  const organizationId = await getSingleOrganizationId();
  const { error } = await (supabase.from("employees") as any).insert({
    organization_id: organizationId,
    name: fields.name,
    short_name: fields.shortName,
    phone: fields.phone,
    email: fields.email,
    position: fields.position,
    employment_status: fields.employmentStatus,
    birth_date: fields.birthDate,
    hire_date: fields.hireDate,
    line_id: fields.lineId,
  });
  if (error) {
    throw new Error(`新增員工失敗：${error.message}`);
  }
}

export async function updateEmployee(id: string, fields: EmployeeFields): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await (supabase.from("employees") as any)
    .update({
      name: fields.name,
      short_name: fields.shortName,
      phone: fields.phone,
      email: fields.email,
      position: fields.position,
      employment_status: fields.employmentStatus,
      birth_date: fields.birthDate,
      hire_date: fields.hireDate,
      line_id: fields.lineId,
    })
    .eq("id", id);
  if (error) {
    throw new Error(`更新員工資料失敗：${error.message}`);
  }
}

export interface StaffAssignment {
  id: string;
  employeeId: string;
  employeeName: string;
  /** 員工簡稱，本日班表/每月班表這種空間有限的地方顯示這個就好，不用全名 */
  employeeShortName: string;
  propertyId: string | null;
  propertyCode: string | null;
  propertyName: string | null;
  workDate: string;
  notes: string | null;
}

function mapAssignmentRow(row: any): StaffAssignment {
  return {
    id: row.id as string,
    employeeId: row.employee_id as string,
    employeeName: (row.employees?.name as string) ?? "",
    employeeShortName: (row.employees?.short_name as string) || (row.employees?.name as string) || "",
    propertyId: (row.property_id as string) ?? null,
    propertyCode: (row.properties?.code as string) ?? null,
    propertyName: (row.properties?.name as string) ?? null,
    workDate: row.work_date as string,
    notes: (row.notes as string) ?? null,
  };
}

export async function createStaffAssignment(params: {
  employeeId: string;
  propertyId: string | null;
  workDate: string;
  notes: string | null;
}): Promise<void> {
  const supabase = createServiceRoleClient();
  const organizationId = await getSingleOrganizationId();
  const { error } = await (supabase.from("staff_assignments") as any).insert({
    organization_id: organizationId,
    employee_id: params.employeeId,
    property_id: params.propertyId,
    work_date: params.workDate,
    notes: params.notes,
  });
  if (error) {
    throw new Error(`新增排班失敗：${error.message}`);
  }
}

/** 修改一筆已存在的排班（換人、換民宿、換日期、改備註） */
export async function updateStaffAssignment(
  id: string,
  params: {
    employeeId: string;
    propertyId: string | null;
    workDate: string;
    notes: string | null;
  }
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await (supabase.from("staff_assignments") as any)
    .update({
      employee_id: params.employeeId,
      property_id: params.propertyId,
      work_date: params.workDate,
      notes: params.notes,
    })
    .eq("id", id);
  if (error) {
    throw new Error(`修改排班失敗：${error.message}`);
  }
}

export async function deleteStaffAssignment(id: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("staff_assignments").delete().eq("id", id);
  if (error) {
    throw new Error(`刪除排班失敗：${error.message}`);
  }
}

/**
 * 刪除某民宿在某一天的所有房務排班——訂單的退房日期被改掉時用這個
 * 清掉舊退房日對應的排班（見 app/components/reservations-search.tsx
 * 的 saveEdit 說明：日期改了之後，原本排的房務人員不一定能配合新
 * 日期，需要跟他們重新確認，所以先清掉、之後再重新安排，不會讓
 * 系統顯示「已經有人負責」但其實那個人根本不知道日期變了）。
 */
export async function deleteStaffAssignmentsForPropertyDate(propertyId: string, workDate: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("staff_assignments").delete().eq("property_id", propertyId).eq("work_date", workDate);
  if (error) {
    throw new Error(`清除房務排班失敗：${error.message}`);
  }
}

const ASSIGNMENT_SELECT = "id, employee_id, property_id, work_date, notes, employees(name, short_name), properties(code, name)";

/** 查某一天的排班（本日班表用），依建立時間排序 */
export async function listStaffAssignmentsForDate(date: string): Promise<StaffAssignment[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("staff_assignments")
    .select(ASSIGNMENT_SELECT)
    .eq("work_date", date)
    .order("created_at");
  if (error) {
    throw new Error(`查詢當日排班失敗：${error.message}`);
  }
  return ((data ?? []) as any[]).map(mapAssignmentRow);
}

/** 查某個月份範圍內的排班（每月班表用） */
export async function listStaffAssignmentsForMonth(
  monthStart: string,
  monthEndExclusive: string
): Promise<StaffAssignment[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("staff_assignments")
    .select(ASSIGNMENT_SELECT)
    .gte("work_date", monthStart)
    .lt("work_date", monthEndExclusive)
    .order("work_date");
  if (error) {
    throw new Error(`查詢當月排班失敗：${error.message}`);
  }
  return ((data ?? []) as any[]).map(mapAssignmentRow);
}

/** 某間民宿在某一天，接下來最近一筆入住的準備內容——房務任務內容用這個即時算出來，不重複存 */
export interface UpcomingPrepInfo {
  reservationId: string;
  reservationNo: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  guestName: string;
  bookingSource: string;
  /** 每個房型一個項目，例如 ["1 間雙人套房", "3 間四人套房"]——跟
   * 報價單同一套 roomAllocationSummaryItems() 格式化邏輯，呈現方式
   * 也要比照報價單一行一個房型，不是逗號串成一行文字，所以這裡是
   * 陣列，不是 join 好的字串 */
  roomItems: string[];
  hasBbq: boolean;
  hasExtraBed: boolean;
}

export async function getUpcomingPrepInfo(propertyId: string, onOrAfterDate: string): Promise<UpcomingPrepInfo | null> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("reservations")
    .select(
      "id, reservation_no, check_in, check_out, adults, children, booking_source, status, four_person_suite_count, four_person_downgrade_count, double_suite_count, double_plain_count, guests(name)"
    )
    .eq("property_id", propertyId)
    .gte("check_in", onOrAfterDate)
    .neq("status", "cancelled")
    .order("check_in")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`查詢即將入住資訊失敗：${error.message}`);
  }
  const row = data as any;
  if (!row) return null;

  const allocation = {
    fourPersonSuiteCount: Number(row.four_person_suite_count ?? 0),
    fourPersonDowngradeCount: Number(row.four_person_downgrade_count ?? 0),
    doubleSuiteCount: Number(row.double_suite_count ?? 0),
    doublePlainCount: Number(row.double_plain_count ?? 0),
  };
  const roomItems = roomAllocationSummaryItems(allocation).map((item) => item.text);

  const { data: itemsData, error: itemsError } = await supabase
    .from("reservation_items")
    .select("item_type")
    .eq("reservation_id", row.id);
  if (itemsError) {
    throw new Error(`查詢加購項目失敗：${itemsError.message}`);
  }
  const itemTypes = new Set(((itemsData ?? []) as any[]).map((i) => i.item_type as string));

  const nights = Math.round(
    (new Date(`${row.check_out}T00:00:00Z`).getTime() - new Date(`${row.check_in}T00:00:00Z`).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  return {
    reservationId: row.id as string,
    reservationNo: row.reservation_no as string,
    checkIn: row.check_in as string,
    checkOut: row.check_out as string,
    nights,
    adults: Number(row.adults ?? 0),
    children: Number(row.children ?? 0),
    guestName: (row.guests?.name as string) ?? "",
    bookingSource: row.booking_source as string,
    roomItems,
    hasBbq: itemTypes.has("bbq"),
    hasExtraBed: itemTypes.has("extra_bed_fixed") || itemTypes.has("extra_bed_temporary"),
  };
}

/**
 * 訂單跟房務排班的比對結果：這筆訂單的退房日，該民宿有沒有排到房務
 * 人員。判斷方式是拿「訂單的 property_id + check_out」去比對
 * staff_assignments 有沒有這個組合——沒有任何一筆 staff_assignments
 * 符合，就代表這筆訂單目前還沒有分配房務人員，需要顯示警告。
 *
 * 用「退房日」而不是「入住日」，是因為實際打掃/整理是在客人離開之後
 * 才進行，為的是準備給下一組客人——所以房務工作真正發生的日期是
 * 這一筆訂單的退房日，不是入住日。
 */
export interface CheckOutCoverage {
  reservationId: string;
  reservationNo: string;
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  checkOut: string;
  guestName: string;
  hasAssignment: boolean;
  /** 這筆退房訂單有沒有加購烤肉，月曆格子上要顯示 */
  hasBbq: boolean;
}

export async function getCheckOutCoverage(monthStart: string, monthEndExclusive: string): Promise<CheckOutCoverage[]> {
  const supabase = createServiceRoleClient();

  const { data: reservationsData, error: resError } = await supabase
    .from("reservations")
    .select("id, reservation_no, property_id, check_out, guests(name), properties(code, name)")
    .gte("check_out", monthStart)
    .lt("check_out", monthEndExclusive)
    .neq("status", "cancelled");
  if (resError) {
    throw new Error(`查詢退房訂單失敗：${resError.message}`);
  }

  const reservations = (reservationsData ?? []) as any[];
  if (reservations.length === 0) return [];

  const reservationIds = reservations.map((row) => row.id as string);

  const [{ data: assignmentsData, error: assignError }, { data: bbqItemsData, error: bbqError }] = await Promise.all([
    supabase
      .from("staff_assignments")
      .select("property_id, work_date")
      .gte("work_date", monthStart)
      .lt("work_date", monthEndExclusive),
    supabase.from("reservation_items").select("reservation_id").in("reservation_id", reservationIds).eq("item_type", "bbq"),
  ]);
  if (assignError) {
    throw new Error(`查詢排班失敗：${assignError.message}`);
  }
  if (bbqError) {
    throw new Error(`查詢烤肉加購項目失敗：${bbqError.message}`);
  }

  const assignedSet = new Set(((assignmentsData ?? []) as any[]).map((a) => `${a.property_id}|${a.work_date}`));
  const bbqSet = new Set(((bbqItemsData ?? []) as any[]).map((r) => r.reservation_id as string));

  return reservations.map((row) => ({
    reservationId: row.id as string,
    reservationNo: row.reservation_no as string,
    propertyId: row.property_id as string,
    propertyCode: (row.properties?.code as string) ?? "",
    propertyName: (row.properties?.name as string) ?? "",
    checkOut: row.check_out as string,
    guestName: (row.guests?.name as string) ?? "",
    hasAssignment: assignedSet.has(`${row.property_id}|${row.check_out}`),
    hasBbq: bbqSet.has(row.id as string),
  }));
}

/**
 * 幫某位員工建立登入帳號（Supabase Auth），建好後把
 * employees.user_id 連結過去。用 service role 的
 * auth.admin.createUser() API，不用讓員工自己收驗證信、自己註冊——
 * 內部員工帳號直接視為已驗證（email_confirm: true）。
 *
 * 這是「第一階段」權限控管的一部分：帳號建好、能登入，但目前所有
 * 登入的人權限都一樣（不分管理員/管家/房務員），角色權限之後再加。
 */
export async function createEmployeeLoginAccount(employeeId: string, email: string, password: string): Promise<void> {
  const supabase = createServiceRoleClient();

  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError || !authUser.user) {
    throw new Error(`建立登入帳號失敗：${authError?.message ?? "未知錯誤"}`);
  }

  const { error: updateError } = await (supabase.from("employees") as any)
    .update({ user_id: authUser.user.id })
    .eq("id", employeeId);
  if (updateError) {
    throw new Error(`帳號建立成功，但連結員工資料失敗：${updateError.message}`);
  }
}

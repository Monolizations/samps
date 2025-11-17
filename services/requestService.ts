import { Database } from "@/types/database.types";
import { SupabaseClient } from "@supabase/supabase-js";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";

// ---------------------------
// INSERT REQUEST BY USER ID
// ---------------------------
export const insertRequestByUserId = async (
  userId: string,
  postId: string,
  supabase: SupabaseClient<Database>
) => {
  const { data, error } = await supabase
    .from("requests")
    .insert({
      user_id: userId,
      post_id: postId,
    })
    .select("*"); // select inserted row(s)

  if (error) throw error;
  return data ?? [];
};

// ---------------------------
// FETCH REQUESTS BY USER ID
// Optional: filter by postId if provided
// ---------------------------
export const fetchRequestByUserId = async (
  userId: string,
  postId: string | null,
  supabase: SupabaseClient<Database>
) => {
  let query = supabase
    .from("requests")
    .select("*, post:posts(*, post_user:users(*))")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (postId) query = query.eq("post_id", postId);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
};

// ---------------------------
// FETCH ALL REQUESTS FOR A POST
// Useful to disable request button for everyone
// ---------------------------
export const fetchAllRequestsByPostId = async (
  postId: string,
  supabase: SupabaseClient<Database>
) => {
  const { data, error } = await supabase
    .from("requests")
    .select("*")
    .eq("post_id", postId);

  if (error) throw error;
  return data ?? [];
};

// DELETE/DISAPPROVE REQUEST
export const deleteRequest = async (id: string, supabase: SupabaseClient<Database>) => {
  const { error } = await supabase
    .from("requests")
    .delete()
    .eq("id", id);

  if (error) throw error;
  return true;
};

// requestService.ts
export const updateRequest = async (
  requestId: string,
  supabase: SupabaseClient<Database>
) => {
  // Get current state first
  const { data: existing, error: fetchError } = await supabase
    .from("requests")
    .select("requested, confirmed")
    .eq("id", requestId)
    .single();

  if (fetchError) throw fetchError;
  if (!existing) throw new Error("Request not found");

  let updateData = {};

  // Logic:
  // 1️⃣ If not requested yet → mark requested = true
  // 2️⃣ If requested but not confirmed yet → mark confirmed = true
  if (!existing.requested) {
    updateData = { requested: true };
  } else if (!existing.confirmed) {
    updateData = { confirmed: true };
  } else {
    // already confirmed — no more changes
    return existing;
  }

  const { data, error } = await supabase
    .from("requests")
    .update(updateData)
    .eq("id", requestId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
};


// FETCH REQUEST BY USERiD
type RequestWithUser = {
  id: string;
  title: string;
  avatar: string;
  time: string;
  postId: string;
  user: Database["public"]["Tables"]["users"]["Row"];
  requested: boolean;
  post: Database["public"]["Tables"]["posts"]["Row"] & { created_at: string }; // Assuming posts have created_at
  confirmed: boolean;
  created_at: string; // Add created_at for sorting later
};

export const fetchAllRequests = async (
  postIds: string[],
  supabase: SupabaseClient<Database>
): Promise<RequestWithUser[]> => {
  if (!postIds.length) return [];

  const { data, error } = await supabase
    .from("requests")
    .select(`
      *,
      user:user_id (*),
      post:post_id (*)
    `)
    .in("post_id", postIds)
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!data) return [];

  const defaultAvatar = "https://i.pravatar.cc/150";

  return data.map((r: any) => ({
    id: r.id,
    title: `${r.user?.firstname} requested your post "${r.post?.title}"`,
    avatar: r.user?.avatar || defaultAvatar,
    time: formatDistanceToNow(new Date(r.created_at), { addSuffix: true }),
    postId: r.post?.id,
    post: r.post,
    user: r.user,
    requested: r.requested ?? false,
    confirmed: r.confirmed ?? false,
    created_at: r.created_at, // Included for sorting in the component
  }));
};


// ---------------------------
// FETCH APPROVED REQUESTS FOR A USER
// ---------------------------
export const fetchApprovedRequestsByUser = async (
  userId: string,
  supabase: SupabaseClient<Database>
): Promise<RequestWithUser[]> => {
  const { data, error } = await supabase
    .from("requests")
    .select(`
      *,
      user:user_id (*),
      post:post_id (*)
    `)
    .eq("confirmed", true)  // only approved requests
    .eq("user_id", userId)  // only requests by this user
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!data) return [];

  const defaultAvatar = "https://i.pravatar.cc/150";

  return data.map((r: any) => ({
    id: r.id,
    title: `${r.user?.firstname} requested your post "${r.post?.title}"`,
    avatar: r.user?.avatar || defaultAvatar,
    time: formatDistanceToNow(new Date(r.created_at), { addSuffix: true }),
    postId: r.post?.id,
    post: r.post,
    user: r.user,
    requested: r.requested ?? false,
    confirmed: r.confirmed ?? false,
    created_at: r.created_at, // Included for sorting
  }));
};

export const fetchRequestsByUser = async (
  userId: string,
  supabase: SupabaseClient<Database>
): Promise<RequestWithUser[]> => {
  const { data, error } = await supabase
    .from("requests")
    .select(`*, user:user_id(*), post:post_id(*)`)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  const defaultAvatar = "https://i.pravatar.cc/150";

  return (data ?? []).map((r: any) => ({
    id: r.id,
    title: `${r.user?.firstname} requested your post "${r.post?.title}"`,
    avatar: r.user?.avatar || defaultAvatar,
    time: formatDistanceToNow(new Date(r.created_at), { addSuffix: true }),
    postId: r.post?.id,
    post: r.post,
    user: r.user,
    requested: r.requested ?? false,
    confirmed: r.confirmed ?? false,
    created_at: r.created_at, // Included for sorting
  }));
};


// ---------------------------
// FETCH ALL ACCOUNT VERIFICATION MESSAGES (Rejection History)
// ---------------------------
// 🚨 MODIFIED FUNCTION TO FETCH ALL MESSAGES
export const fetchAllVerificationMessages = async (
  userId: string,
  supabase: SupabaseClient<Database>
) => {
  const { data, error } = await supabase
    .from("verify_account")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false }); // Sort descending (newest rejection first)

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) return [];

  return data.map((d: { reject_msg: string | null; created_at: string | null }) => ({
    reject_msg: d.reject_msg,
    created_at: d.created_at,
    // Safely create Date object for formatting, fall back if created_at is null
    time: formatDistanceToNow(d.created_at ? new Date(d.created_at) : new Date(), { addSuffix: true }),
  }));
};
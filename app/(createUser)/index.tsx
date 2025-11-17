import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useUser } from "@clerk/clerk-expo";
import { useForm, Controller } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSupabase } from "@/lib/supabase";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { registerUser } from "@/services/userService";
import { TablesInsert } from "@/types/database.types";

type Form = TablesInsert<"users">;

type FormValues = {
  role: "student" | "landlord" | "";
  firstname?: string;
  lastname?: string;
  contact: number;
  student_id?: number;
  school?: string;
  landlord_proof_id?: string;
  student_proof_id?: string; // Added student_proof_id to FormValues
  avatar?: string;
};

export default function CreateUser() {
  const { user } = useUser();
  const supabase = useSupabase();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [uploading, setUploading] = useState(false);
  // Renamed selectedImage to landlordSelectedImage for clarity
  const [landlordSelectedImage, setLandlordSelectedImage] = useState<
    string | undefined
  >();
  // NEW state for student proof
  const [studentSelectedImage, setStudentSelectedImage] = useState<
    string | undefined
  >();
  const [avatar, setAvatar] = useState<string | undefined>();
  const [loading, setLoading] = useState(true); // ⏳ initial loading indicator

  // 🔹 Simulate 2-second loading before showing form
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  const { control, watch, setValue } = useForm<FormValues>({
    defaultValues: { role: "" },
  });

  const role = watch("role");

  // --- Avatar Logic ---
  const pickAvatarAsync = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      alert("Permission to access gallery is required!");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (!result.canceled && result.assets?.length > 0) {
      setAvatar(result.assets[0].uri);
    }
  };

  const removeAvatar = () => setAvatar(undefined);
  
  // --- Generic Proof Image Picker Logic ---
  const pickProofImageAsync = async (
    setSelectedImage: React.Dispatch<React.SetStateAction<string | undefined>>
  ) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      alert("Permission to access gallery is required!");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 1,
    });
    if (!result.canceled && result.assets?.length > 0) {
      setSelectedImage(result.assets[0].uri);
    }
  };

  // --- Upload Logic ---
  const uploadImage = async (localUri: string, bucket: string) => {
    try {
      setUploading(true);
      const fileRes = await fetch(localUri);
      const arrayBuffer = await fileRes.arrayBuffer();
      const fileExt = localUri.split(".").pop()?.toLowerCase() ?? "jpeg";
      const path = `${Date.now()}.${fileExt}`;

      const { error, data } = await supabase.storage
        .from(bucket)
        .upload(path, arrayBuffer, {
          contentType: `image/${fileExt}`,
        });

      if (error) throw error;
      return data.path;
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to upload image.");
      return undefined;
    } finally {
      setUploading(false);
    }
  };

  const DEFAULT_AVATAR_URL =
    "https://ptwhyrlrfmpyhkwmljlu.supabase.co/storage/v1/object/public/defaults/clerkimg.png";

  // --- Mutation Logic ---
  const { mutate, isPending } = useMutation({
    mutationFn: async () => {
      let avatarPath: string | undefined;
      let landlordProofPath: string | undefined; // Renamed to clarify
      let studentProofPath: string | undefined; // NEW

      if (avatar) {
        avatarPath = avatar
          ? await uploadImage(avatar, "user-profiles")
          : DEFAULT_AVATAR_URL;
      }

      // Landlord proof upload logic
      if (role === "landlord" && landlordSelectedImage) {
        landlordProofPath = await uploadImage(
          landlordSelectedImage,
          "user-profiles"
        );
      }
      
      // Student proof upload logic
      if (role === "student" && studentSelectedImage) {
        studentProofPath = await uploadImage(
          studentSelectedImage,
          "user-profiles"
        );
      }

      // 🚨 NEW LOGIC: Set role to landlord_unverified if landlord is selected
      const roleToSubmit =
        role === "landlord" ? "landlord_unverified" : role || "";


      return registerUser(
        {
          firstname: watch("firstname"),
          lastname: watch("lastname"),
          contact: Number(watch("contact")),
          student_id: role === "student" ? Number(watch("student_id")) : null,
          school: role === "student" ? watch("school") : null,
          landlord_proof_id: landlordProofPath, // Submitting landlord proof path
          student_proof_id: studentProofPath, // Submitting student proof path
          avatar: avatarPath,
          account_type: roleToSubmit, // Use the dynamically determined role
          id: user?.id || "",
          username: user?.username || "",
          email: user?.emailAddresses?.[0]?.emailAddress || "",
        },
        supabase
      );
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      router.replace("/(protected)/home");
      Alert.alert("Success", "Account created successfully!");
    },
    onError: (err: any) => {
      console.error(err);
      Alert.alert("Error", "Failed to register account.");
    },
  });

  const onSubmit = () => mutate();

  const clerkImg = require("@/assets/images/clerkimg.png");

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#2563eb" />
        <Text className="mt-3 text-gray-600">Registering account...</Text>
      </View>
    );
  }

  // 🧩 Show skeleton if Clerk user not ready
  if (!user?.id) {
    return (
      <View className="flex-1 items-center justify-center">
        <Skeleton className="h-8 w-48 mb-4 rounded" />
      </View>
    );
  }

  // ✅ Main form
  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 20 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="items-center mb-6">
            <TouchableOpacity onPress={pickAvatarAsync}>
              <Image
                source={avatar ? { uri: avatar } : clerkImg}
                className="w-24 h-24 rounded-full border-2 border-gray-300"
              />
              <View className="absolute bottom-0 right-0 bg-blue-600 rounded-full p-2">
                <Ionicons name="camera" size={18} color="white" />
              </View>
            </TouchableOpacity>

            {avatar && (
              <TouchableOpacity onPress={removeAvatar} className="mt-2">
                <Text className="text-red-500">Remove</Text>
              </TouchableOpacity>
            )}

            <Text className="text-lg font-semibold mt-3 dark:text-white">
              {user.username}
            </Text>
          </View>

          {/* Role selection */}
          <Text className="text-base font-semibold mb-2">Register as:</Text>
          <View className="flex-row gap-3 mb-4">
            {["student", "landlord"].map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => setValue("role", r as "student" | "landlord")}
                className={`flex-1 p-3 rounded-xl border ${
                  role === r ? "border-blue-500 dark:bg-black" : "dark:bg-gray-500"
                }`}
              >
                <Text className="text-center capitalize font-medium dark:text-white">
                  {r}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Common fields (Firstname, Lastname, Contact) ... */}
          <Label className="text-sm">Firstname</Label>
          <Controller
            control={control}
            name="firstname"
            render={({ field: { onChange, value } }) => (
              <Input
                placeholder="Enter your firstname"
                value={value}
                onChangeText={onChange}
                className="mb-4"
              />
            )}
          />

          <Label className="text-sm">Lastname</Label>
          <Controller
            control={control}
            name="lastname"
            render={({ field: { onChange, value } }) => (
              <Input
                placeholder="Enter your lastname"
                value={value}
                onChangeText={onChange}
                className="mb-4"
              />
            )}
          />

          <Label className="text-sm">Contact Number</Label>
          <Controller
            control={control}
            name="contact"
            render={({ field: { onChange, value } }) => (
              <Input
                placeholder="Enter your contact number"
                keyboardType="number-pad"
                value={value?.toString() || ""}
                onChangeText={onChange}
                className="mb-4"
              />
            )}
          />

          {/* Student-only fields */}
          {role === "student" && (
            <>
              <Label className="text-sm">Student ID</Label>
              <Controller
                control={control}
                name="student_id"
                render={({ field: { onChange, value } }) => (
                  <Input
                    placeholder="Enter your Student ID"
                    keyboardType="number-pad"
                    value={value?.toString() || ""}
                    onChangeText={onChange}
                    className="mb-4"
                  />
                )}
              />

              <Label className="text-sm">School</Label>
              <Controller
                control={control}
                name="school"
                render={({ field: { onChange, value } }) => (
                  <Input
                    placeholder="Enter your school name"
                    value={value}
                    onChangeText={onChange}
                    className="mb-4"
                  />
                )}
              />

              {/* 🖼️ NEW: Student Proof ID Upload */}
              <Text className="text-sm mb-2">Student ID Proof</Text>
              <TouchableOpacity
                onPress={() => pickProofImageAsync(setStudentSelectedImage)}
                className="p-3 rounded-xl border border-dashed border-gray-400 items-center justify-center mb-4 relative"
              >
                {studentSelectedImage ? (
                  <View>
                    <Image
                      source={{ uri: studentSelectedImage }}
                      style={{
                        width: 200,
                        height: 200,
                        borderRadius: 10,
                        resizeMode: "cover",
                      }}
                    />
                    <TouchableOpacity
                      onPress={() => setStudentSelectedImage(undefined)}
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        backgroundColor: "rgba(0,0,0,0.7)",
                        borderRadius: 9999,
                        padding: 5,
                      }}
                    >
                      <Ionicons name="close" size={18} color="white" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View className="w-32 h-32 rounded bg-gray-200 items-center justify-center">
                    {uploading ? (
                      <ActivityIndicator size="small" color="#2563eb" />
                    ) : (
                      <Text className="text-gray-500">Tap to select image</Text>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            </>
          )}

          {/* Landlord-only proof */}
          {role === "landlord" && (
            <>
              <Text className="text-sm mb-2">Valid ID Proof</Text>
              <TouchableOpacity
                onPress={() => pickProofImageAsync(setLandlordSelectedImage)}
                className="p-3 rounded-xl border border-dashed border-gray-400 items-center justify-center mb-4 relative"
              >
                {landlordSelectedImage ? (
                  <View>
                    <Image
                      source={{ uri: landlordSelectedImage }}
                      style={{
                        width: 200,
                        height: 200,
                        borderRadius: 10,
                        resizeMode: "cover",
                      }}
                    />
                    <TouchableOpacity
                      onPress={() => setLandlordSelectedImage(undefined)}
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        backgroundColor: "rgba(0,0,0,0.7)",
                        borderRadius: 9999,
                        padding: 5,
                      }}
                    >
                      <Ionicons name="close" size={18} color="white" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View className="w-32 h-32 rounded bg-gray-200 items-center justify-center">
                    {uploading ? (
                      <ActivityIndicator size="small" color="#2563eb" />
                    ) : (
                      <Text className="text-gray-500">Tap to select image</Text>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            </>
          )}

          <Button className="mt-4" disabled={isPending} onPress={onSubmit}>
            <Text className="text-white font-medium">
              {isPending ? "Registering..." : "Register Account"}
            </Text>
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
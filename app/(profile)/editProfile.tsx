import React, { useEffect, useState } from "react";
import {
    View,
    Text,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    Alert,
    ActivityIndicator,
    TouchableOpacity,
    Image,
} from "react-native";
import { useUser } from "@clerk/clerk-expo";
import { useForm, Controller } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSupabase } from "@/lib/supabase";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getUserById, updateUser } from "@/services/userService";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "@/types/database.types";
import HeaderBtn from "@/components/HeaderBtn";

type FormValues = {
    // 🚨 Updated role type to explicitly include landlord_unverified
    role: "student" | "landlord" | "landlord_unverified" | ""; 
    firstname?: string;
    lastname?: string;
    contact: number;
    student_id?: number;
    school?: string;
    landlord_proof_id?: string;
    avatar?: string;
};

// 🚨 NEW HELPER FUNCTION to check if the role is any type of landlord
const isLandlordRole = (currentRole: string | undefined): boolean => {
    return currentRole === "landlord" || currentRole === "landlord_unverified";
};


export default function CreateUser() {
    const { user } = useUser();
    const supabase = useSupabase();
    const router = useRouter();
    const queryClient = useQueryClient();

    const [uploading, setUploading] = useState(false);
    const [selectedImage, setSelectedImage] = useState<string | undefined>();
    const [avatar, setAvatar] = useState<string | undefined>();
    const [image, setImage] = useState<string | undefined>();

    const id = user?.id;

    // Fetch user data
    const { data, error, isLoading } = useQuery({
        queryKey: ["users", id],
        queryFn: () => getUserById(id as string, supabase),
        enabled: !!id,
    });

    // 🚨 Role now includes 'landlord_unverified' possibility
    const role = data?.account_type as FormValues['role']; 

    const { control, watch } = useForm<FormValues>({
        defaultValues: {
            role: role || "",
            firstname: data?.firstname || "",
            lastname: data?.lastname || "",
            contact: data?.contact || 0,
            student_id: data?.student_id || undefined,
            school: data?.school || "",
            landlord_proof_id: data?.landlord_proof_id || "",
            avatar: data?.avatar || "",
        },
    });

    const { mutate, isPending } = useMutation({
        mutationFn: async () => {
            let avatarPath: string | undefined;
            let proofPath: string | undefined;

            // Determine if the current role requires landlord proof logic
            const requiresLandlordProof = isLandlordRole(role); 

            if (avatar) avatarPath = await uploadImage(avatar, "user-profiles");
            
            // 🚨 Use the new helper function for the mutation logic
            if (requiresLandlordProof && selectedImage)
                proofPath = await uploadImage(selectedImage, "user-profiles");

            return updateUser(
                user?.id || "",
                {
                    firstname: watch("firstname"),
                    lastname: watch("lastname"),
                    contact: Number(watch("contact")),
                    student_id: role === "student" ? Number(watch("student_id")) : null,
                    school: role === "student" ? watch("school") : null,
                    // Pass the new path if uploaded, otherwise, the DB handles the default/existing value.
                    landlord_proof_id: proofPath, 
                    avatar: avatarPath,
                    account_type: role || "",
                    username: user?.username || "",
                    email: user?.emailAddresses?.[0]?.emailAddress || "",
                },
                supabase
            );
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["users"] });
            router.replace("/(protected)/home");
            Alert.alert("Success", "Account updated successfully!");
        },
        onError: (err: any) => {
            console.error(err);
            Alert.alert("Error", "Failed to update account.");
        },
    });

    const onSubmit = () => mutate();

     // 🆕 Avatar Picker
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

  // Upload image helper
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

  // Download image helper
  const downloadImage = async (
    path: string,
    supabase: SupabaseClient<Database>
  ): Promise<string> => {
    const { data, error } = await supabase.storage.from("user-profiles").download(path);

    if (error || !data) throw error || new Error("Failed to download image");

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(data);
    });
  };

    useEffect(() => {
        if (data?.avatar) {
            downloadImage(data.avatar, supabase)
                .then((url) => setImage(url))
                .catch((err) => 
                    Alert.alert("Image not loaded", err)
            );
        }
        
        // 🚨 Use the helper function here to download landlord proof image if user is any type of landlord
        if (data?.landlord_proof_id && isLandlordRole(role)) {
            downloadImage(data.landlord_proof_id, supabase)
                .then((url) => setSelectedImage(url))
                .catch((err) =>
                    Alert.alert("Image not loaded", err)
            );
        }
    }, [data?.avatar, data?.landlord_proof_id, role]); // Added 'role' to dependency array

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
                    {(isLoading || !user?.id) && (
                        <View className="flex-1 justify-center items-center">
                            <Skeleton className="h-8 w-48 mb-4 rounded" />
                            <Text className="text-gray-900 dark:text-white">Loading...</Text>
                        </View>
                    )}

                    {!isLoading && user?.id && (
                        <>
                            <HeaderBtn title="Edit Profile" />

                            {/* Avatar Section */}
                            <View className="items-center mb-6">
                                <TouchableOpacity onPress={pickAvatarAsync}>
                                    <Image
                                        source={{ uri: avatar || image }}
                                        className="w-24 h-24 rounded-full border-2 border-gray-300"
                                    />
                                    <View
                                        style={{
                                            position: "absolute",
                                            bottom: 0,
                                            right: 0,
                                            backgroundColor: "#2563eb",
                                            borderRadius: 9999,
                                            padding: 4,
                                        }}
                                    >
                                        <Ionicons name="camera" size={18} color="white" />
                                    </View>
                                </TouchableOpacity>

                                {avatar && (
                                    <TouchableOpacity onPress={removeAvatar} className="mt-2">
                                        <Text className="text-red-500">Remove</Text>
                                    </TouchableOpacity>
                                )}

                                <Text className="text-gray-500 text-sm font-semibold mt-3 dark:text-white">
                                    {user.username}
                                </Text>
                            </View>

                            {/* Common Fields */}
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

                            {/* Student Fields */}
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
                                </>
                            )}

                            {/* Landlord Proof */}
                            {/* 🚨 CONDITIONAL RENDERING: Use the helper function */}
                            {isLandlordRole(role) && (
                                <>
                                    <Text className="text-sm mb-2">Valid ID Proof</Text>
                                    <TouchableOpacity
                                        onPress={async () => {
                                            const { status } =
                                                await ImagePicker.requestMediaLibraryPermissionsAsync();
                                            if (status !== "granted") {
                                                alert("Permission required!");
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
                                        }}
                                        className="p-3 rounded-xl border border-dashed border-gray-400 items-center justify-center mb-4 relative"
                                    >
                                        {selectedImage ? (
                                            <View>
                                                <Image
                                                    source={{ uri: selectedImage }}
                                                    style={{
                                                        width: 200,
                                                        height: 200,
                                                        borderRadius: 10,
                                                        resizeMode: "cover",
                                                    }}
                                                />
                                                <TouchableOpacity
                                                    onPress={() => setSelectedImage(undefined)}
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
                                                    <Skeleton className="h-8 w-48 mb-4 rounded" />
                                                ) : (
                                                    <Text className="text-gray-500">Tap to select image</Text>
                                                )}
                                            </View>
                                        )}
                                    </TouchableOpacity>
                                </>
                            )}

                            {/* Submit */}
                            <Button className="mt-4" disabled={isPending} onPress={onSubmit}>
                                <Text className="text-white font-medium">
                                    {isPending ? "Updating..." : "Update Account"}
                                </Text>
                            </Button>
                        </>
                    )}
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}